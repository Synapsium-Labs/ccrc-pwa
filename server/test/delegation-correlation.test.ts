// Delegation broker wave 3, Task 11: the PURE join qualification and correlation ladder.
//
// `correlateDelegation` decides, from durably accepted evidence and one worktree-census record, which delegation activity a worktree
// belongs to, or that the answer is unresolved, conflicting, unmeasured or run-child-owned (spec §5.4). It does no IO and emits no
// effect. The rows below hold it to the plan's mutation rows W3-M41 to M48, the correlation halves of M49 and M63, and the rows
// W3-M59 and M66 that `delegation-model.test.ts` also pins.
//
// Two groups. The JOIN-ORDER rows run the real fold (`recoverDelegation`) over journals written in every order the real lanes
// produced, because "which event opens an activity, and which record is its identity" is decided by the fold that
// `namedAgentsOf` feeds. The LADDER rows then hand `correlateDelegation` the activities and evidence such a fold produced, so the
// two halves are tested against each other and not against hand-built rows that could drift from it.
//
// Fixtures only: names are `lane-a-demo`, `project-a`, `/fixture/...`. No file is read or written.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DelegationEventEnvelopeV1 } from '../../shared/api.js';
import {
  buildDelegationJournalRecord,
  delegationRetentionViewOf,
  planDelegationPruning,
} from '../src/coord/delegation-journal.js';
import {
  DelegationCheckpointBuilder,
  DelegationCheckpointError,
  decodeDelegationCheckpoint,
  encodeDelegationCheckpoint,
  namedAgentsOf,
  recoverDelegation,
} from '../src/coord/delegation-checkpoint.js';
import {
  DELEGATION_CLOCK_SKEW_MS,
  DELEGATION_CORRELATION_REASONS,
  DELEGATION_DROPPED_UNMEASURED,
  DELEGATION_EVIDENCE_MARGIN_MS,
  correlateDelegation,
  delegationDroppedKeyId,
  delegationDroppedKeyOf,
  delegationGoneTrees,
  delegationLeaseSourceOfLinked,
  delegationTreeKey,
  indexDelegationDropped,
  planDelegationDroppedPrune,
  prunableDelegationDropped,
  DELEGATION_NO_MARKS,
  DELEGATION_ROOT_UNMEASURED,
  delegationMarkAttributionOf,
  delegationUnknownWindowForced,
  delegationLostEvidenceForced,
  delegationHashSetAdd,
  delegationHashSetHas,
  delegationMarkForced,
  emptyDelegationHashSet,
  type DelegationLostMarks,
  type DelegationCorrelationInput,
  type DelegationCorrelationVerdict,
  type DelegationDroppedKey,
  type DelegationListingWindow,
  type DelegationPruneProject,
} from '../src/coord/delegation-correlation.js';
import {
  delegationSha256Hex,
  deriveDelegationActivityId,
  encodeDelegationNaturalKey,
  formatDelegationInstant,
  leaseSourceKindOfActivity,
  type DelegationActivityRow,
  type DelegationCensusRecord,
  type DelegationJournalEntryV1,
  type DelegationJournalRecordV1,
} from '../src/coord/delegation-model.js';

// ── fixtures ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const PARENT = 'lane-a-demo';
const OTHER = 'lane-b-demo';
const INC = 'g1';
const CLAUDE = '11111111-2222-3333-4444-555555555555';
const CLAUDE_AFTER_CLEAR = '66666666-7777-8888-9999-000000000000';
const AGENT = 'abc123def456';                       // an upstream agent ID (the worktree is `agent-<id>`)
const AGENT_2 = 'fed654cba321';
const REPO = 'project-a';
const WT = (name: string): string => `/fixture/${REPO}/.claude/worktrees/${name}`;
const T = (s: number): string => formatDelegationInstant(Date.UTC(2026, 9, 14) + s * 1000);
const eid = (n: number): string => delegationSha256Hex(`fixture-correlation-event-${n}`);

interface Over { sessionId?: string; parentIncarnation?: string; claudeSessionId?: string; cwd?: string }
const base = (n: number, over: Over = {}) => ({
  v: 1 as const, observedAt: T(n), sessionId: over.sessionId ?? PARENT, parentIncarnation: over.parentIncarnation ?? INC,
  claudeSessionId: over.claudeSessionId ?? CLAUDE, ...(over.cwd === undefined ? {} : { cwd: over.cwd }),
  eventId: eid(n + (over.sessionId === OTHER ? 5000 : 0)), bucket: '2026101400', startOffset: n * 100, endOffset: n * 100 + 99,
});
const sessionStart = (n: number, over: Over = {}, source = 'startup'): DelegationEventEnvelopeV1 => ({ ...base(n, over), eventKind: 'SessionStart', source });
const sessionEnd = (n: number, reason: string, over: Over = {}): DelegationEventEnvelopeV1 => ({ ...base(n, over), eventKind: 'SessionEnd', reason });
/** A tool event that names an agent only through the common `agentId` field: the event's EMITTER. Not a qualifying join. */
const bareTool = (n: number, agentId: string, over: Over = {}): DelegationEventEnvelopeV1 =>
  ({ ...base(n, over), eventKind: 'PostToolUse', toolName: 'Bash', toolUseId: `toolu_${n}`, outcome: 'completed', agentId });
const subagentStart = (n: number, agentId: string, over: Over = {}, agentType: string | null = null): DelegationEventEnvelopeV1 =>
  ({ ...base(n, over), eventKind: 'SubagentStart', agentId, agentType });
const subagentStop = (n: number, agentId: string, over: Over = {}): DelegationEventEnvelopeV1 =>
  ({ ...base(n, over), eventKind: 'SubagentStop', agentId, agentType: null, agentTranscriptPath: null });
const agentLaunch = (n: number, agentId: string, status: 'async-launched' | 'completed' = 'async-launched', over: Over = {}): DelegationEventEnvelopeV1 =>
  ({ ...base(n, over), eventKind: 'PostToolUse', toolName: 'Agent', toolUseId: `toolu_${n}`, outcome: status, launch: { status, agentId, isAsync: status === 'async-launched' } });
const workflowLaunch = (n: number, runId: string, status: 'async-launched' | 'completed' = 'async-launched', over: Over = {}): DelegationEventEnvelopeV1 =>
  ({ ...base(n, over), eventKind: 'PostToolUse', toolName: 'Workflow', toolUseId: `toolu_${n}`, outcome: status,
    launch: { status, taskId: 'task_1', taskType: 'local_workflow', workflowName: 'review-pass', runId, transcriptDir: `/fixture/transcripts/${runId}`, scriptPath: '/fixture/scripts/review-pass.js' } });
const bashPre = (n: number, toolUseId: string, listing?: readonly string[], over: Over = {}): DelegationEventEnvelopeV1 =>
  ({ ...base(n, over), eventKind: 'PreToolUse', toolName: 'Bash', toolUseId, ...(listing === undefined ? {} : { listing }) });
const bashPost = (n: number, toolUseId: string, listing?: readonly string[], over: Over = {}): DelegationEventEnvelopeV1 =>
  ({ ...base(n, over), eventKind: 'PostToolUse', toolName: 'Bash', toolUseId, outcome: 'completed', ...(listing === undefined ? {} : { listing }) });

const evidence = (event: DelegationEventEnvelopeV1): DelegationJournalEntryV1 => ({ kind: 'evidence-accepted', event });
function evidenceChain(events: readonly DelegationEventEnvelopeV1[]): DelegationJournalRecordV1[] {
  const out: DelegationJournalRecordV1[] = [];
  let prev: string | null = null;
  events.forEach((event, i) => {
    const r = buildDelegationJournalRecord({ sequence: i + 1, acceptedAt: T(100000 + i + 1), previousDigest: prev, entry: evidence(event) });
    out.push(r);
    prev = r.digest;
  });
  return out;
}

/** The fold of a journal: what the checkpoint holds, and the evidence as correlation is handed it. */
function world(events: readonly DelegationEventEnvelopeV1[]) {
  const records = evidenceChain(events);
  const report = recoverDelegation(null, records);
  expect(report.failure).toBeNull();
  const acceptedEvidence = records.map((r) => {
    if (r.entry.kind !== 'evidence-accepted') throw new Error('fixture journals hold evidence only');
    return { journalId: r.journalId, event: r.entry.event };
  });
  return { records, report, builder: report.facts!.builder, cp: report.state.checkpoint, activities: report.state.checkpoint.activities, acceptedEvidence };
}
const activityOf = (activities: readonly DelegationActivityRow[], sourceKind: DelegationActivityRow['sourceKind'], upstreamId: string, parentId = PARENT): DelegationActivityRow | undefined =>
  activities.find((a) => a.sourceKind === sourceKind && a.upstreamId === upstreamId && a.parentId === parentId);
const keyOf = (sourceKind: 'agent' | 'workflow' | 'bash-worktree', upstreamId: string, over: Over = {}) =>
  ({ parentId: over.sessionId ?? PARENT, parentIncarnation: over.parentIncarnation ?? INC, sourceKind, upstreamId });
const sorted = (ids: readonly string[]): string[] => [...new Set(ids)].sort();

const record = (over: Partial<DelegationCensusRecord> = {}): DelegationCensusRecord => ({
  project: REPO, adminRecord: `agent-${AGENT}`, canonicalPath: WT(`agent-${AGENT}`), headBranch: `worktree-agent-${AGENT}`, headSha: null,
  claudeBase: 'main', locked: false, baseAgreesFirstLog: true, state: 'present', diagnostic: null, ...over,
});
const input = (over: Partial<DelegationCorrelationInput> = {}): DelegationCorrelationInput => ({
  record: record(), runChildAgreement: null, activities: [], acceptedEvidence: [], pointMetas: [], listingWindows: [],
  birthPassesRemaining: 0, hasRegistryRow: false, hasChildMarker: false, evidenceHorizon: null, droppedEvidence: indexDelegationDropped([]),
  // X1 (R84): a first sighting far after every instant the rows use, so no row meets the creator bracket unless it names its own
  firstSighting: { after: T(1_000_000), at: T(1_000_060) }, ...over,
});
const meta = (over: Partial<DelegationCorrelationInput['pointMetas'][number]> & { evidenceJournalId: string }): DelegationCorrelationInput['pointMetas'][number] => ({
  parentId: PARENT, parentIncarnation: INC, sourceKind: 'agent', upstreamId: AGENT, worktreePath: WT(`agent-${AGENT}`), ...over,
});
const win = (over: Partial<DelegationListingWindow> = {}): DelegationListingWindow => ({
  sessionId: PARENT, parentIncarnation: INC, toolUseId: 'toolu_b1', repository: REPO, startedAt: T(10), endedAt: T(12),
  before: ['main-wt'], after: ['main-wt', 'wt-raw'], ...over,
});
const deepFreeze = <T>(o: T): T => {
  if (o !== null && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); }
  return o;
};
const kindOf = (v: DelegationCorrelationVerdict): string => v.kind;

/** A world where an agent-named tree has EVERYTHING rung 2 asks for: the launch, a start, a stop, and an exact point meta. */
function agentWorld(over: Partial<DelegationCorrelationInput> = {}) {
  const w = world([agentLaunch(1, AGENT), subagentStart(2, AGENT), subagentStop(3, AGENT)]);
  const m = meta({ evidenceJournalId: w.records[0]!.journalId });
  const base: DelegationCorrelationInput = input({ activities: w.activities, acceptedEvidence: w.acceptedEvidence, pointMetas: [m], ...over });
  return { w, m, base };
}
/** A world where a raw-named tree is reachable only by rung 3 (a subagent's own cwd) or rung 4 (a creation delta). */
const RAW = 'wt-raw';
const rawRecord = (over: Partial<DelegationCensusRecord> = {}): DelegationCensusRecord => record({ adminRecord: RAW, canonicalPath: WT(RAW), headBranch: 'raw-branch', ...over });

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// STEP 1: the join-order table (the fold, in every order the real lanes produced)
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

describe('join-order table (W3-M41, W3-M42, W3-M59): which record is an activity\'s identity, and what opens one', () => {
  it('launch before start: the ONE activity is identified by the launch record\'s accepted journalId', () => {
    const w = world([agentLaunch(1, AGENT), subagentStart(2, AGENT)]);
    expect(w.activities).toHaveLength(1);
    const a = w.activities[0]!;
    expect(a.sourceKind).toBe('agent');
    expect(a.identityJournalId).toBe(w.records[0]!.journalId);
    expect(a.activityId).toBe(deriveDelegationActivityId(keyOf('agent', AGENT), w.records[0]!.journalId));
  });

  it('start before launch: the SAME activity, now identified by the start record (the earlier of the two retained)', () => {
    const w = world([subagentStart(1, AGENT), agentLaunch(2, AGENT)]);
    expect(w.activities).toHaveLength(1);
    expect(w.activities[0]!.identityJournalId).toBe(w.records[0]!.journalId);
    expect(w.activities[0]!.activityId).toBe(deriveDelegationActivityId(keyOf('agent', AGENT), w.records[0]!.journalId));
    // …and the other order's ID is a different one: the identity record is the only thing that moved.
    expect(w.activities[0]!.activityId).not.toBe(world([agentLaunch(1, AGENT), subagentStart(2, AGENT)]).activities[0]!.activityId);
  });

  it('the envelope eventId NEVER substitutes for the accepted journalId (W3-M59 against the fold)', () => {
    const w = world([agentLaunch(1, AGENT), subagentStart(2, AGENT)]);
    const a = w.activities[0]!;
    const rawEventId = w.acceptedEvidence[0]!.event.eventId;
    expect(rawEventId).not.toBe(w.records[0]!.journalId);
    expect(a.identityJournalId).not.toBe(rawEventId);
    expect(a.activityId).not.toBe(deriveDelegationActivityId(keyOf('agent', AGENT), rawEventId));
  });

  it('positive meta after a bare event: the activity opens on the meta, identified by the EARLIEST retained naming record', () => {
    const w = world([bareTool(1, AGENT), bareTool(2, AGENT)]);
    expect(w.activities).toEqual([]);                                             // a bare agent_id opens nothing (W3-M41)
    const opened = w.builder.openFromMeta(PARENT, INC, AGENT);
    expect(opened.kind).toBe('opened');
    const a = w.builder.build(1).activities[0]!;
    expect(a.identityJournalId).toBe(w.records[0]!.journalId);                    // not the later bare record, not the meta read
    expect(a.activityId).toBe(deriveDelegationActivityId(keyOf('agent', AGENT), w.records[0]!.journalId));
    expect(opened.kind === 'opened' && opened.activityId).toBe(a.activityId);
  });

  it('a positive meta with NO retained naming record waits: a meta read alone chooses no identity', () => {
    const w = world([sessionStart(1)]);
    expect(w.builder.openFromMeta(PARENT, INC, AGENT)).toEqual({ kind: 'waiting-for-evidence' });
    expect(w.builder.build(1).activities).toEqual([]);
  });

  it('a bare event after a join attaches to the activity and does not move its identity', () => {
    const w = world([subagentStart(1, AGENT), bareTool(2, AGENT)]);
    expect(w.activities).toHaveLength(1);
    const a = w.activities[0]!;
    expect(a.identityJournalId).toBe(w.records[0]!.journalId);
    expect(a.lastEventAt).toBe(T(2));
    expect(a.executionState).toBe('active');
  });

  it('a bare event BEFORE a join is the identity record once the join arrives (the earliest retained naming record)', () => {
    const w = world([bareTool(1, AGENT), sessionStart(2), subagentStart(3, AGENT)]);
    expect(w.activities).toHaveLength(1);
    expect(w.activities[0]!.identityJournalId).toBe(w.records[0]!.journalId);
    expect(w.cp.pruningHolds.filter((h) => h.reason === 'identity-candidate')).toEqual([]);   // the mapping now holds the ID
  });

  describe('a bare occurrence PRUNED before the join (through recovery from a checkpoint)', () => {
    // sequence 1 is the bare occurrence; the checkpoint is taken at 3 with X still unjoined; the join arrives at 4.
    const prefix = evidenceChain([bareTool(1, AGENT), sessionStart(2), sessionStart(3)]);
    const checkpoint = recoverDelegation(null, prefix).state.checkpoint;
    const all = evidenceChain([bareTool(1, AGENT), sessionStart(2), sessionStart(3), subagentStart(4, AGENT)]);
    const suffix = all.slice(2);                                               // the journal now begins at the anchor (3): sequences 1 and 2 are gone

    it('the checkpoint holds the bare record, so a journal that has lost it is refused, never silently re-identified', () => {
      expect(checkpoint.pruningHolds).toContainEqual({ journalId: prefix[0]!.journalId, reason: 'identity-candidate', ownerId: encodeDelegationNaturalKey(keyOf('agent', AGENT)) });
      const report = recoverDelegation(encodeDelegationCheckpoint(checkpoint), suffix);
      expect(report.failure?.code).toBe('held-evidence-missing');
      expect(report.state.phase).toBe('reconstructing');
    });
    it('once the bare record is genuinely no longer retained evidence (no hold), the join\'s own record is the identity, never the pruned one', () => {
      const unheld = { ...checkpoint, pruningHolds: checkpoint.pruningHolds.filter((h) => h.reason !== 'identity-candidate') };
      const report = recoverDelegation(encodeDelegationCheckpoint(unheld), suffix);
      expect(report.failure).toBeNull();
      const act = activityOf(report.state.checkpoint.activities, 'agent', AGENT)!;
      expect(act.identityJournalId).toBe(all[3]!.journalId);                   // the join's record
      expect(act.identityJournalId).not.toBe(all[0]!.journalId);               // never the pruned bare record
      expect(act.activityId).not.toBe(world([bareTool(1, AGENT), sessionStart(2), sessionStart(3), subagentStart(4, AGENT)]).activities[0]!.activityId);
    });
  });

  it('an unpaired SubagentStop opens NOTHING (W3-M42), however many follow, and is a candidate only', () => {
    const w = world([subagentStop(1, AGENT), subagentStop(2, AGENT), subagentStop(3, AGENT_2)]);
    expect(w.activities).toEqual([]);
    expect(w.cp.activityIdsByNaturalKey).toEqual({});
  });

  it('an unpaired stop that a join later follows is the earliest retained naming record, and the activity is then ended by it', () => {
    const w = world([subagentStop(1, AGENT), subagentStart(2, AGENT)]);
    expect(w.activities).toHaveLength(1);
    expect(w.activities[0]!.identityJournalId).toBe(w.records[0]!.journalId);
    expect(w.activities[0]!.executionState).toBe('ended');
  });

  // `Stop` is not a spool variant (the closed event union cannot carry one, and the hook never writes one), so no journal can hold it:
  // this row pins `namedAgentsOf` alone, and the fold loop below holds the orders a Stop would have bracketed, not a Stop itself.
  it('a parent Stop is not a delegation event: it names nothing, opens nothing, and closes nothing', () => {
    const parentStop = { ...base(2), eventKind: 'Stop' } as unknown as DelegationEventEnvelopeV1;
    expect(namedAgentsOf(parentStop)).toEqual([]);
    // a workflow run in flight: neither where a parent Stop would fall nor its absence changes the run's identity or its worker
    for (const events of [
      [workflowLaunch(1, 'wf_run1'), subagentStart(2, AGENT)],
      [subagentStart(1, AGENT), workflowLaunch(2, 'wf_run1')],
    ]) {
      const w = world(events);
      const launch = w.records[events.findIndex((e) => e.eventKind === 'PostToolUse')]!;
      expect(w.builder.openWorkflowWorkerFromMeta(PARENT, INC, 'wf_run1', 1).kind).toBe('opened');
      const worker = activityOf(w.builder.build(1).activities, 'workflow', 'wf_run1-1')!;
      expect(worker.identityJournalId).toBe(launch.journalId);
      expect(worker.executionState).toBe('active');
    }
  });

  it('an empty or absent agent_type does not decide anything: a SubagentStart opens, a bare tool event does not', () => {
    for (const agentType of [null, '', 'general-purpose']) {
      const w = world([subagentStart(1, AGENT, {}, agentType)]);
      expect(w.activities, `agent_type ${JSON.stringify(agentType)}`).toHaveLength(1);
    }
    expect(world([bareTool(1, AGENT)]).activities).toEqual([]);
  });

  it('ToolSearch before a Workflow call: ToolSearch names nothing, and the Workflow launch is the run\'s identity record', () => {
    const toolSearchPre = { ...base(1), eventKind: 'PreToolUse', toolName: 'ToolSearch', toolUseId: 'toolu_ts', isolation: null } as unknown as DelegationEventEnvelopeV1;
    const toolSearchPost = { ...base(2), eventKind: 'PostToolUse', toolName: 'ToolSearch', toolUseId: 'toolu_ts', outcome: 'completed', launch: null } as unknown as DelegationEventEnvelopeV1;
    expect(namedAgentsOf(toolSearchPre)).toEqual([]);
    expect(namedAgentsOf(toolSearchPost)).toEqual([]);
    const w = world([workflowLaunch(3, 'wf_run1')]);                           // the ToolSearch pair wrote no line: only the launch is retained
    expect(w.builder.openWorkflowWorkerFromMeta(PARENT, INC, 'wf_run1', 0).kind).toBe('opened');
    const worker = activityOf(w.builder.build(1).activities, 'workflow', 'wf_run1-0')!;
    expect(worker.identityJournalId).toBe(w.records[0]!.journalId);
    expect(worker.activityId).toBe(deriveDelegationActivityId(keyOf('workflow', 'wf_run1-0'), w.records[0]!.journalId));
  });

  it('a Workflow worker waits for its RUN\'s opened activity (R44: the launch opens it): a meta alone chooses no identity', () => {
    const w = world([sessionStart(1), subagentStart(2, AGENT)]);
    expect(w.builder.openWorkflowWorkerFromMeta(PARENT, INC, 'wf_run1', 0)).toEqual({ kind: 'waiting-for-evidence' });
    expect(w.builder.openWorkflowWorkerFromMeta(PARENT, INC, 'wf_run1', 0)).toEqual({ kind: 'waiting-for-evidence' });
  });

  it('every worker of one run is identified by the run\'s earliest retained record, and reopening is idempotent', () => {
    const w = world([workflowLaunch(1, 'wf_run1')]);
    const a = w.builder.openWorkflowWorkerFromMeta(PARENT, INC, 'wf_run1', 0);
    const b = w.builder.openWorkflowWorkerFromMeta(PARENT, INC, 'wf_run1', 1);
    expect(a.kind).toBe('opened');
    expect(b.kind).toBe('opened');
    const rows = w.builder.build(1).activities;
    expect(rows.map((r) => r.upstreamId).sort()).toEqual(['wf_run1', 'wf_run1-0', 'wf_run1-1']);          // the run, then its two workers
    expect(new Set(rows.map((r) => r.identityJournalId))).toEqual(new Set([w.records[0]!.journalId]));
    expect(a.kind === 'opened' && b.kind === 'opened' && a.activityId !== b.activityId).toBe(true);
    expect(w.builder.openWorkflowWorkerFromMeta(PARENT, INC, 'wf_run1', 0)).toEqual({ kind: 'already-open', activityId: a.kind === 'opened' ? a.activityId : '' });
  });

  it('a Workflow launch that reports completed ends its workers at open; the launch opens the RUN and never a worker by itself', () => {
    const w = world([workflowLaunch(1, 'wf_run1', 'completed')]);
    expect(w.activities.map((a) => [a.sourceKind, a.upstreamId, a.executionState])).toEqual([['workflow', 'wf_run1', 'ended']]);   // the run, not a worker: the index comes from the meta
    w.builder.openWorkflowWorkerFromMeta(PARENT, INC, 'wf_run1', 0);
    expect(activityOf(w.builder.build(1).activities, 'workflow', 'wf_run1-0')!.executionState).toBe('ended');
  });

  it('a Bash call that mentions no worktree opens nothing and holds nothing; one that carries a listing opens a bash-worktree activity', () => {
    const quiet = world([bashPre(1, 'toolu_q'), bashPost(2, 'toolu_q')]);
    expect(quiet.activities).toEqual([]);
    expect(quiet.cp.pruningHolds.map((h) => h.reason)).toEqual(['checkpoint-anchor']);
    const listed = world([bashPre(1, 'toolu_b1', ['main-wt']), bashPost(2, 'toolu_b1', ['main-wt', 'wt-raw'])]);
    expect(listed.activities).toHaveLength(1);
    const a = listed.activities[0]!;
    expect(a.sourceKind).toBe('bash-worktree');
    expect(a.upstreamId).toBe('toolu_b1');
    expect(a.identityJournalId).toBe(listed.records[0]!.journalId);
    expect(a.executionState).toBe('ended');                                    // its PostToolUse ended it
    expect(a.activityId).toBe(deriveDelegationActivityId(keyOf('bash-worktree', 'toolu_b1'), listed.records[0]!.journalId));
  });

  it('a Bash PostToolUse whose listing was dropped (truncated) still ends the activity its PreToolUse opened', () => {
    const w = world([bashPre(1, 'toolu_b1', ['main-wt']), bashPost(2, 'toolu_b1')]);
    expect(w.activities).toHaveLength(1);
    expect(w.activities[0]!.executionState).toBe('ended');
  });

  it('SessionEnd /clear rotates the Claude session UUID under the SAME ccd identity: one activity, one ID, both UUIDs recorded', () => {
    const rotated = world([
      subagentStart(1, AGENT), sessionEnd(2, 'clear'), sessionStart(3, { claudeSessionId: CLAUDE_AFTER_CLEAR }, 'clear'),
      subagentStop(4, AGENT, { claudeSessionId: CLAUDE_AFTER_CLEAR }),
    ]);
    const plain = world([subagentStart(1, AGENT), sessionStart(2), sessionStart(3), subagentStop(4, AGENT)]);
    expect(rotated.activities).toHaveLength(1);
    expect(rotated.activities[0]!.activityId).toBe(plain.activities[0]!.activityId);     // the rotation changed nothing about identity
    expect(rotated.activities[0]!.identityJournalId).toBe(rotated.records[0]!.journalId);
    expect(rotated.activities[0]!.executionState).toBe('ended');                         // a stop under the NEW UUID still ends it
    expect(rotated.cp.sessions).toHaveLength(1);
    expect([...rotated.cp.sessions[0]!.claudeSessionIds].sort()).toEqual([CLAUDE, CLAUDE_AFTER_CLEAR].sort());
  });

  it('SessionEnd itself neither opens nor ends an activity', () => {
    const w = world([subagentStart(1, AGENT), sessionEnd(2, 'clear'), sessionEnd(3, 'other')]);
    expect(w.activities).toHaveLength(1);
    expect(w.activities[0]!.executionState).toBe('active');
    expect(namedAgentsOf(sessionEnd(1, 'clear'))).toEqual([]);
  });

  it('namedAgentsOf names exactly: agents (launch/start join; stop and emitter do not), workflow runs (the launch response is the run join), Bash tool calls (a join only with a listing)', () => {
    expect(namedAgentsOf(agentLaunch(1, AGENT))).toEqual([{ sourceKind: 'agent', upstreamId: AGENT, join: true, ends: false }]);
    expect(namedAgentsOf(agentLaunch(1, AGENT, 'completed'))).toEqual([{ sourceKind: 'agent', upstreamId: AGENT, join: true, ends: true }]);
    expect(namedAgentsOf(subagentStart(1, AGENT))).toEqual([{ sourceKind: 'agent', upstreamId: AGENT, join: true, ends: false }]);
    expect(namedAgentsOf(subagentStop(1, AGENT))).toEqual([{ sourceKind: 'agent', upstreamId: AGENT, join: false, ends: true }]);
    // a Bash tool call inside a subagent names its emitter (bare) and, with no listing, its own call (not a join)
    expect(namedAgentsOf(bareTool(1, AGENT))).toEqual([
      { sourceKind: 'agent', upstreamId: AGENT, join: false, ends: false },
      { sourceKind: 'bash-worktree', upstreamId: 'toolu_1', join: false, ends: true },
    ]);
    expect(namedAgentsOf(workflowLaunch(1, 'wf_run1'))).toEqual([{ sourceKind: 'workflow', upstreamId: 'wf_run1', join: true, ends: false }]);
    expect(namedAgentsOf(workflowLaunch(1, 'wf_run1', 'completed'))).toEqual([{ sourceKind: 'workflow', upstreamId: 'wf_run1', join: true, ends: true }]);
    expect(namedAgentsOf(bashPre(1, 'toolu_b1', ['a']))).toEqual([{ sourceKind: 'bash-worktree', upstreamId: 'toolu_b1', join: true, ends: false }]);
    expect(namedAgentsOf(bashPost(1, 'toolu_b1', ['a']))).toEqual([{ sourceKind: 'bash-worktree', upstreamId: 'toolu_b1', join: true, ends: true }]);
    expect(namedAgentsOf(bashPost(1, 'toolu_b1'))).toEqual([{ sourceKind: 'bash-worktree', upstreamId: 'toolu_b1', join: false, ends: true }]);
    expect(namedAgentsOf(sessionStart(1))).toEqual([]);
  });

  it('the builder type is the one fold: a Bash-listing activity survives recovery from the journal alone, ID for ID', () => {
    const events = [bashPre(1, 'toolu_b1', ['main-wt']), subagentStart(2, AGENT), bashPost(3, 'toolu_b1', ['main-wt', 'wt-raw'])];
    const a = world(events);
    const b = world(events);
    expect(b.cp).toEqual(a.cp);
    expect(a.builder).toBeInstanceOf(DelegationCheckpointBuilder);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// STEP 2: the rung tables, positive and near-miss
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

describe('rung 1: run-child agreement is its own terminal verdict', () => {
  it('positive: an agreement is `run-child-owned`, carrying its activity and evidence and NO rung and NO lease request', () => {
    const v = correlateDelegation(input({ runChildAgreement: { activityId: 'act-1', evidenceJournalIds: ['j1', 'j2'] } }));
    expect(v).toEqual({ kind: 'run-child-owned', activityId: 'act-1', evidenceJournalIds: ['j1', 'j2'] });
    expect(v).not.toHaveProperty('rung');
    expect(v).not.toHaveProperty('request');
  });
  it('it is distinct from every linked verdict: a rung-2 `linked` is not `run-child-owned`, and neither contains the other', () => {
    const { base } = agentWorld();
    const linked = correlateDelegation(base);
    const owned = correlateDelegation({ ...base, runChildAgreement: { activityId: 'act-1', evidenceJournalIds: [] } });
    expect(linked.kind).toBe('linked');
    expect(owned.kind).toBe('run-child-owned');
  });
  it('rung 1 decides before everything: even an unreadable record, a birth wait and a conflict beneath it do not outrank it', () => {
    for (const over of [
      { record: record({ state: 'unreadable' as const }) }, { birthPassesRemaining: 2 as const }, { hasRegistryRow: true }, { hasChildMarker: true },
      { record: record({ canonicalPath: null }) },
    ]) {
      expect(correlateDelegation(input({ runChildAgreement: { activityId: 'act-1', evidenceJournalIds: ['j1'] }, ...over })).kind).toBe('run-child-owned');
    }
  });
  it('near-miss: a registry row or a .child marker WITHOUT agreement is a ccd workspace, never a lease and never run-child-owned', () => {
    for (const over of [{ hasRegistryRow: true }, { hasChildMarker: true }, { hasRegistryRow: true, hasChildMarker: true }]) {
      const v = correlateDelegation(agentWorld(over).base);
      expect(v.kind).toBe('unresolved');
      expect(v.kind === 'unresolved' && v.reason).toBe('ccd-workspace-not-a-lease');
    }
  });
  it('the agreement\'s evidence list is copied, not aliased', () => {
    const ids = ['j1'];
    const v = correlateDelegation(input({ runChildAgreement: { activityId: 'act-1', evidenceJournalIds: ids } }));
    expect(v.evidenceJournalIds).toEqual(ids);
    expect(v.evidenceJournalIds).not.toBe(ids);
  });
});

describe('rung 2: exact upstream identity (agent)', () => {
  it('positive: launch + start + stop + a meta naming exactly the canonical path links at rung 2, with every proving record', () => {
    const { w, base } = agentWorld();
    const v = correlateDelegation(base);
    expect(v).toEqual({
      kind: 'linked', activityId: activityOf(w.activities, 'agent', AGENT)!.activityId, rung: 2,
      evidenceJournalIds: sorted(w.records.map((r) => r.journalId)),
    });
  });
  it('positive in either join order (start before launch), the same verdict shape', () => {
    const w = world([subagentStart(1, AGENT), agentLaunch(2, AGENT), subagentStop(3, AGENT)]);
    const v = correlateDelegation(input({ activities: w.activities, acceptedEvidence: w.acceptedEvidence, pointMetas: [meta({ evidenceJournalId: w.records[0]!.journalId })] }));
    expect(v.kind).toBe('linked');
    expect(v.kind === 'linked' && v.rung).toBe(2);
  });
  it('a SubagentStart alone (no stop yet) is enough with the exact meta: the spec asks for a start OR a stop', () => {
    const w = world([subagentStart(1, AGENT)]);
    const v = correlateDelegation(input({ activities: w.activities, acceptedEvidence: w.acceptedEvidence, pointMetas: [meta({ evidenceJournalId: w.records[0]!.journalId })] }));
    expect(v.kind).toBe('linked');
  });
  it('near-miss: no meta read yet is `unmeasured` (retried), never linked from the name and the spool alone', () => {
    const { base } = agentWorld({ pointMetas: [] });
    const v = correlateDelegation(base);
    expect(v.kind).toBe('unmeasured');
  });
  it('near-miss: a meta but NO SubagentStart/Stop from the parent is `unmeasured` (a launch response alone is not rung-2 evidence)', () => {
    const w = world([agentLaunch(1, AGENT)]);
    const v = correlateDelegation(input({ activities: w.activities, acceptedEvidence: w.acceptedEvidence, pointMetas: [meta({ evidenceJournalId: w.records[0]!.journalId })] }));
    expect(v.kind).toBe('unmeasured');
  });
  it('near-miss: exact evidence but the activity is not yet durably open is `unmeasured`, retried once Task 13 opens it', () => {
    const { base } = agentWorld({ activities: [] });
    expect(correlateDelegation(base).kind).toBe('unmeasured');
  });
  it('near-miss: evidence for ANOTHER agent id does not link this tree', () => {
    const w = world([agentLaunch(1, AGENT_2), subagentStart(2, AGENT_2)]);
    const v = correlateDelegation(input({ activities: w.activities, acceptedEvidence: w.acceptedEvidence, pointMetas: [meta({ upstreamId: AGENT_2, evidenceJournalId: w.records[0]!.journalId })] }));
    expect(v.kind).toBe('unmeasured');
  });
});

describe('rung 2: exact upstream identity (workflow)', () => {
  const WF = 'wf_run1-1';
  const wfRecord = (over: Partial<DelegationCensusRecord> = {}): DelegationCensusRecord => record({ adminRecord: WF, canonicalPath: WT(WF), headBranch: 'worktree-wf-run1-1', ...over });
  function wfWorld() {
    const w = world([workflowLaunch(1, 'wf_run1'), subagentStart(2, AGENT)]);
    w.builder.openWorkflowWorkerFromMeta(PARENT, INC, 'wf_run1', 1);
    const activities = w.builder.build(1).activities;
    const m = meta({ sourceKind: 'workflow', upstreamId: WF, worktreePath: WT(WF), evidenceJournalId: w.records[0]!.journalId });
    return { w, activities, m, base: input({ record: wfRecord(), activities, acceptedEvidence: w.acceptedEvidence, pointMetas: [m] }) };
  }
  it('positive: a workflow meta naming exactly the canonical path links the worker\'s activity at rung 2', () => {
    const { w, activities, base } = wfWorld();
    const v = correlateDelegation(base);
    expect(v).toEqual({
      kind: 'linked', activityId: activityOf(activities, 'workflow', WF)!.activityId, rung: 2,
      evidenceJournalIds: [w.records[0]!.journalId],
    });
  });
  it('near-miss: the same meta for a different worker index does not link this tree', () => {
    const { base, m } = wfWorld();
    expect(correlateDelegation({ ...base, pointMetas: [{ ...m, upstreamId: 'wf_run1-2' }] }).kind).toBe('unmeasured');
  });
  it('near-miss: no meta, or a meta whose activity is not open, is `unmeasured`', () => {
    const { base } = wfWorld();
    expect(correlateDelegation({ ...base, pointMetas: [] }).kind).toBe('unmeasured');
    expect(correlateDelegation({ ...base, activities: [] }).kind).toBe('unmeasured');
  });
  it('a worker needs no SubagentStart/Stop: the spec\'s workflow rung is the meta alone', () => {
    const w = world([workflowLaunch(1, 'wf_run1')]);
    w.builder.openWorkflowWorkerFromMeta(PARENT, INC, 'wf_run1', 1);
    const m = meta({ sourceKind: 'workflow', upstreamId: WF, worktreePath: WT(WF), evidenceJournalId: w.records[0]!.journalId });
    expect(correlateDelegation(input({ record: wfRecord(), activities: w.builder.build(1).activities, acceptedEvidence: w.acceptedEvidence, pointMetas: [m] })).kind).toBe('linked');
  });
});

describe('rung 3: the subagent\'s own path', () => {
  const toolIn = (n: number, agentId: string | undefined, cwd: string, over: Over = {}): DelegationEventEnvelopeV1 =>
    ({ ...base(n, { ...over, cwd }), eventKind: 'PostToolUse', toolName: 'Bash', toolUseId: `toolu_${n}`, outcome: 'completed', ...(agentId === undefined ? {} : { agentId }) });
  const rec = rawRecord();
  it('positive: an event from inside a JOINED subagent of S whose cwd equals the canonical path links at rung 3', () => {
    const w = world([subagentStart(1, AGENT), toolIn(2, AGENT, WT(RAW))]);
    const v = correlateDelegation(input({ record: rec, activities: w.activities, acceptedEvidence: w.acceptedEvidence }));
    expect(v).toEqual({
      kind: 'linked', activityId: activityOf(w.activities, 'agent', AGENT)!.activityId, rung: 3,
      evidenceJournalIds: sorted(w.records.map((r) => r.journalId)),
    });
  });
  it('near-miss: the same event from an agent NO qualifying join established is retained evidence, not placement', () => {
    const w = world([toolIn(1, AGENT, WT(RAW))]);
    expect(w.activities).toEqual([]);
    const v = correlateDelegation(input({ record: rec, activities: w.activities, acceptedEvidence: w.acceptedEvidence }));
    expect(v.kind).toBe('unresolved');
  });
  it('near-miss: the parent session\'s own cwd (no agentId) never links', () => {
    const w = world([subagentStart(1, AGENT), toolIn(2, undefined, WT(RAW))]);
    expect(correlateDelegation(input({ record: rec, activities: w.activities, acceptedEvidence: w.acceptedEvidence })).kind).toBe('unresolved');
  });
  it('near-miss: a cwd that is NEAR the path (a parent directory, a child directory, a trailing slash) is not equal to it', () => {
    for (const cwd of [WT(RAW) + '/', WT(RAW) + '/src', `/fixture/${REPO}/.claude/worktrees`, WT(RAW).toUpperCase()]) {
      const w = world([subagentStart(1, AGENT), toolIn(2, AGENT, cwd)]);
      expect(correlateDelegation(input({ record: rec, activities: w.activities, acceptedEvidence: w.acceptedEvidence })).kind, cwd).toBe('unresolved');
    }
  });
  it('near-miss: an event with NO cwd does not equal anything', () => {
    const noCwd: DelegationEventEnvelopeV1 = { ...base(2), eventKind: 'PostToolUse', toolName: 'Bash', toolUseId: 'toolu_2', outcome: 'completed', agentId: AGENT };
    const w = world([subagentStart(1, AGENT), noCwd]);
    expect(correlateDelegation(input({ record: rec, activities: w.activities, acceptedEvidence: w.acceptedEvidence })).kind).toBe('unresolved');
  });
  it('the agent\'s start under another incarnation of the same ccd id is another parent: it does not place this one', () => {
    const w = world([subagentStart(1, AGENT, { parentIncarnation: 'g2' }), toolIn(2, AGENT, WT(RAW), { parentIncarnation: 'g2' })]);
    const v = correlateDelegation(input({ record: rec, activities: w.activities, acceptedEvidence: w.acceptedEvidence }));
    expect(v.kind).toBe('linked');                                              // it IS linked, to the g2 parent's activity
    expect(v.kind === 'linked' && activityOf(w.activities, 'agent', AGENT)!.parentIncarnation).toBe('g2');
  });
});

describe('rung 4: the session\'s own creation delta', () => {
  const rec = rawRecord();
  const bashWorld = (extra: readonly DelegationEventEnvelopeV1[] = []) =>
    world([bashPre(10, 'toolu_b1', ['main-wt']), bashPost(12, 'toolu_b1', ['main-wt', RAW]), ...extra]);
  it('positive: ONE Bash call whose listings differ by exactly the one added record links at rung 4 to the call\'s bash-worktree activity', () => {
    const w = bashWorld();
    const v = correlateDelegation(input({ record: rec, activities: w.activities, acceptedEvidence: w.acceptedEvidence, listingWindows: [win({ after: ['main-wt', RAW] })] }));
    expect(v).toEqual({
      kind: 'linked', activityId: activityOf(w.activities, 'bash-worktree', 'toolu_b1')!.activityId, rung: 4,
      evidenceJournalIds: sorted(w.records.map((r) => r.journalId)),
    });
  });
  it('a bash-worktree activity maps to lease source `raw`, and no wave-3 path emits `attached`', () => {
    const w = bashWorld();
    const act = activityOf(w.activities, 'bash-worktree', 'toolu_b1')!;
    expect(leaseSourceKindOfActivity(act.sourceKind)).toBe('raw');
    const v = correlateDelegation(input({ record: rec, activities: w.activities, acceptedEvidence: w.acceptedEvidence, listingWindows: [win({ after: ['main-wt', RAW] })] }));
    if (v.kind !== 'linked') throw new Error('expected a link');
    expect(delegationLeaseSourceOfLinked(v, w.activities)).toBe('raw');
    // every linked verdict this file can produce, whatever rung, maps to a wave-3 lease source and never `attached`
    const agent = agentWorld();
    const av = correlateDelegation(agent.base);
    if (av.kind !== 'linked') throw new Error('expected a link');
    expect(delegationLeaseSourceOfLinked(av, agent.w.activities)).toBe('agent');
    for (const source of [delegationLeaseSourceOfLinked(v, w.activities), delegationLeaseSourceOfLinked(av, agent.w.activities)]) expect(source).not.toBe('attached');
  });
  it('delegationLeaseSourceOfLinked refuses a verdict whose activity it was not handed (no silent default)', () => {
    expect(() => delegationLeaseSourceOfLinked({ kind: 'linked', activityId: 'missing', rung: 4, evidenceJournalIds: [] }, [])).toThrow(/missing/);
  });
  it('near-miss: a raw one-record delta whose window is NOT overlapped is the only link; the SAME delta with an overlapping other-session window is unresolved', () => {
    const w = bashWorld();
    const mine = win({ after: ['main-wt', RAW] });
    const alone = correlateDelegation(input({ record: rec, activities: w.activities, acceptedEvidence: w.acceptedEvidence, listingWindows: [mine] }));
    expect(alone.kind).toBe('linked');
    const other = win({ sessionId: OTHER, toolUseId: 'toolu_o1', startedAt: T(11), endedAt: T(13), before: ['main-wt'], after: ['main-wt'] });
    const overlapped = correlateDelegation(input({ record: rec, activities: w.activities, acceptedEvidence: w.acceptedEvidence, listingWindows: [mine, other] }));
    expect(overlapped.kind).toBe('unresolved');
    expect(overlapped.kind === 'unresolved' && overlapped.reason).toBe('overlapping-listing-window');
  });
  it.each([
    ['two records added', { after: ['main-wt', RAW, 'wt-other'] }],
    ['one added and one removed', { before: ['main-wt', 'old-wt'], after: ['main-wt', RAW] }],
    ['a different record added', { after: ['main-wt', 'wt-other'] }],
    ['nothing changed', { after: ['main-wt'] }],
    ['no after-listing (the call has not finished)', { after: null }],
    ['the record was already present before', { before: ['main-wt', RAW], after: ['main-wt', RAW] }],
  ] as const)('near-miss: %s is not a one-record creation delta', (_label, over) => {
    const w = bashWorld();
    const v = correlateDelegation(input({ record: rec, activities: w.activities, acceptedEvidence: w.acceptedEvidence, listingWindows: [win(over)] }));
    expect(v.kind).toBe('unresolved');
  });
  it('near-miss: a window on ANOTHER repository cannot have created this record', () => {
    const w = bashWorld();
    expect(correlateDelegation(input({ record: rec, activities: w.activities, acceptedEvidence: w.acceptedEvidence, listingWindows: [win({ repository: 'project-b', after: ['main-wt', RAW] })] })).kind).toBe('unresolved');
  });
  it('an other-session window that is disjoint in time, or on another repository, does not block the link', () => {
    const w = bashWorld();
    const mine = win({ after: ['main-wt', RAW] });
    for (const other of [
      win({ sessionId: OTHER, toolUseId: 'toolu_o1', startedAt: T(20), endedAt: T(22), before: [], after: [] }),
      win({ sessionId: OTHER, toolUseId: 'toolu_o1', startedAt: T(1), endedAt: T(5), before: [], after: [] }),
      win({ sessionId: OTHER, toolUseId: 'toolu_o1', repository: 'project-b', startedAt: T(11), endedAt: T(13), before: [], after: [] }),
    ]) {
      expect(correlateDelegation(input({ record: rec, activities: w.activities, acceptedEvidence: w.acceptedEvidence, listingWindows: [mine, other] })).kind).toBe('linked');
    }
  });
  it('overlap is closed at both ends and an unfinished other-session window overlaps everything after its start', () => {
    const w = bashWorld();
    const mine = win({ after: ['main-wt', RAW] });                              // [T10, T12]
    for (const other of [
      win({ sessionId: OTHER, toolUseId: 'toolu_o1', startedAt: T(12), endedAt: T(14), before: [], after: [] }),      // starts at our end
      win({ sessionId: OTHER, toolUseId: 'toolu_o1', startedAt: T(8), endedAt: T(10), before: [], after: [] }),       // ends at our start
      win({ sessionId: OTHER, toolUseId: 'toolu_o1', startedAt: T(5), endedAt: null, before: [], after: null }),      // still open
      win({ sessionId: OTHER, toolUseId: 'toolu_o1', startedAt: T(11), endedAt: T(11), before: [], after: [] }),      // inside ours
      win({ sessionId: OTHER, parentIncarnation: 'g2', toolUseId: 'toolu_o1', startedAt: T(11), endedAt: T(13), before: [], after: [] }), // same ccd id, other incarnation: another parent
    ]) {
      expect(correlateDelegation(input({ record: rec, activities: w.activities, acceptedEvidence: w.acceptedEvidence, listingWindows: [mine, other] })).kind).toBe('unresolved');
    }
  });
  it('an unfinished window of ours is open-ended and so overlaps a later window of another session', () => {
    const w = world([bashPre(10, 'toolu_b1', ['main-wt'])]);
    const open = win({ endedAt: null, after: null });
    const other = win({ sessionId: OTHER, toolUseId: 'toolu_o1', startedAt: T(30), endedAt: T(31), before: [], after: [] });
    // ours has no after-listing, so it is no delta at all: the other window is moot and the answer is the same
    expect(correlateDelegation(input({ record: rec, activities: w.activities, acceptedEvidence: w.acceptedEvidence, listingWindows: [open, other] })).kind).toBe('unresolved');
  });
  it('two of the SAME session\'s windows that each added the record are ambiguous, not a link to either', () => {
    const w = world([bashPre(10, 'toolu_b1', ['main-wt']), bashPost(12, 'toolu_b1', ['main-wt', RAW]), bashPre(20, 'toolu_b2', ['main-wt']), bashPost(22, 'toolu_b2', ['main-wt', RAW])]);
    const a = win({ toolUseId: 'toolu_b1', after: ['main-wt', RAW] });
    const b = win({ toolUseId: 'toolu_b2', startedAt: T(20), endedAt: T(22), after: ['main-wt', RAW] });
    const v = correlateDelegation(input({ record: rec, activities: w.activities, acceptedEvidence: w.acceptedEvidence, listingWindows: [a, b] }));
    expect(v.kind).toBe('unresolved');
    expect(v.kind === 'unresolved' && v.reason, '5477 e: the ambiguity is named').toBe('ambiguous-listing-windows');
  });
  it('5477 e: a main-thread window and its OWN subagent\'s window that overlap and each add the record are ambiguous, never a link to the first toolUseId', () => {
    const sub = (e: DelegationEventEnvelopeV1): DelegationEventEnvelopeV1 => ({ ...e, agentId: 'sub1' });
    const w = world([bashPre(10, 'toolu_b1', ['main-wt']), bashPost(12, 'toolu_b1', ['main-wt', RAW]), sub(bashPre(11, 'toolu_s1', ['main-wt'])), sub(bashPost(13, 'toolu_s1', ['main-wt', RAW]))]);
    const v = correlateDelegation(input({ record: rec, activities: w.activities, acceptedEvidence: w.acceptedEvidence,
      listingWindows: [win({ after: ['main-wt', RAW] }), win({ toolUseId: 'toolu_s1', startedAt: T(11), endedAt: T(13), after: ['main-wt', RAW] })] }));
    expect(v.kind === 'unresolved' && v.reason).toBe('ambiguous-listing-windows');
  });
  it('a delta whose bash-worktree activity is not yet durably open is `unmeasured`, retried', () => {
    const v = correlateDelegation(input({ record: rec, activities: [], acceptedEvidence: [], listingWindows: [win({ after: ['main-wt', RAW] })] }));
    expect(v.kind).toBe('unmeasured');
  });
  it('a listing window with an instant that is not canonical is `unmeasured`: never a guess about overlap', () => {
    const w = bashWorld();
    const v = correlateDelegation(input({ record: rec, activities: w.activities, acceptedEvidence: w.acceptedEvidence, listingWindows: [win({ startedAt: 'yesterday', after: ['main-wt', RAW] }), win({ sessionId: OTHER, toolUseId: 'toolu_o1', startedAt: T(11), endedAt: T(13), before: [], after: [] })] }));
    expect(v.kind).toBe('unmeasured');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// STEP 3: the refusal tables
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

describe('run-child-owned never flows into lease creation (W3-M63, the correlation half)', () => {
  it('the verdict carries no rung and no request, and is not a `linked` verdict by any property a lease writer reads', () => {
    const v = correlateDelegation(input({ runChildAgreement: { activityId: 'act-1', evidenceJournalIds: ['j1'] } }));
    expect(Object.keys(v).sort()).toEqual(['activityId', 'evidenceJournalIds', 'kind']);
    expect(v.kind).not.toBe('linked');
  });
  it('even with perfect rung-2 evidence beside it, the answer is run-child-owned and never `linked`', () => {
    const { base } = agentWorld({ runChildAgreement: { activityId: 'act-1', evidenceJournalIds: ['j1'] } });
    const v = correlateDelegation(base);
    expect(v.kind).toBe('run-child-owned');
    expect(v).not.toHaveProperty('rung');
  });
  it('delegationLeaseSourceOfLinked takes a LINKED verdict only: the type refuses a run-child-owned one', () => {
    const owned: DelegationCorrelationVerdict = { kind: 'run-child-owned', activityId: 'a', evidenceJournalIds: [] };
    // @ts-expect-error a run-child-owned verdict is not a linked one, so it cannot reach a lease source
    expect(() => delegationLeaseSourceOfLinked(owned, [])).toThrow();
  });
});

describe('a tree named agent-* or wf_* stops at rung 2 (W3-M43)', () => {
  const bait = (name: string, which: 'both' | 'rung3' | 'rung4' = 'both') => {
    // rung-3 AND/OR rung-4 evidence that would link a raw-named tree, planted beside a tree named `name` with no rung-2 evidence
    const r3 = [subagentStart(1, AGENT), { ...base(2, { cwd: WT(name) }), eventKind: 'PostToolUse', toolName: 'Bash', toolUseId: 'toolu_2', outcome: 'completed', agentId: AGENT } as DelegationEventEnvelopeV1];
    const r4 = [bashPre(10, 'toolu_b1', ['main-wt']), bashPost(12, 'toolu_b1', ['main-wt', name])];
    const w = world([...(which === 'rung4' ? [] : r3), ...(which === 'rung3' ? [] : r4)]);
    return input({
      record: record({ adminRecord: name, canonicalPath: WT(name) }), activities: w.activities, acceptedEvidence: w.acceptedEvidence,
      listingWindows: which === 'rung3' ? [] : [win({ after: ['main-wt', name] })],
    });
  };
  it.each([[`agent-${AGENT_2}`], ['agent-'], ['wf_run9-3'], ['wf_']])('%s without rung-2 evidence is `unmeasured`, even with rung-3 and rung-4 evidence for it', (name) => {
    const v = correlateDelegation(bait(name));
    expect(v.kind).toBe('unmeasured');
    expect(v.kind === 'unmeasured' && v.reason).toBe('rung-2-evidence-absent');
  });
  it('a raw name with the SAME evidence is reachable by rungs 3 and 4 (control: the stop is the routing, not the evidence)', () => {
    for (const which of ['rung3', 'rung4'] as const) expect(correlateDelegation(bait('wt-plain', which)).kind, which).toBe('linked');
  });
  it('5477 a: an agent-* tree that appears inside ANOTHER session\'s Bash window is never that session\'s: without the parent\'s meta it is unmeasured(rung-2-meta-absent); with it, rung 2 links the parent', () => {
    const name = `agent-${AGENT}`;
    // P (PARENT) started the agent; Q (OTHER) ran a worktree-naming Bash call whose delta is exactly the agent's tree
    const w = world([subagentStart(1, AGENT), bashPre(10, 'toolu_q1', ['main-wt'], { sessionId: OTHER }), bashPost(12, 'toolu_q1', ['main-wt', name], { sessionId: OTHER })]);
    const qWindow = win({ sessionId: OTHER, toolUseId: 'toolu_q1', after: ['main-wt', name] });
    const rec = record({ adminRecord: name, canonicalPath: WT(name) });
    const partial = correlateDelegation(input({ record: rec, activities: w.activities, acceptedEvidence: w.acceptedEvidence, listingWindows: [qWindow] }));
    expect(partial.kind === 'unmeasured' && partial.reason, 'no meta yet: retried, never Q\'s link').toBe('rung-2-meta-absent');
    const full = correlateDelegation(input({ record: rec, activities: w.activities, acceptedEvidence: w.acceptedEvidence, listingWindows: [qWindow],
      pointMetas: [meta({ evidenceJournalId: w.records[0]!.journalId })] }));
    expect(full).toMatchObject({ kind: 'linked', rung: 2, activityId: activityOf(w.activities, 'agent', AGENT)!.activityId });
    // control: the same window on a raw name is rung 4's, to Q
    const raw = world([bashPre(10, 'toolu_q1', ['main-wt'], { sessionId: OTHER }), bashPost(12, 'toolu_q1', ['main-wt', 'wt-plain'], { sessionId: OTHER })]);
    const control = correlateDelegation(input({ record: record({ adminRecord: 'wt-plain', canonicalPath: WT('wt-plain') }), activities: raw.activities, acceptedEvidence: raw.acceptedEvidence,
      listingWindows: [win({ sessionId: OTHER, toolUseId: 'toolu_q1', after: ['main-wt', 'wt-plain'] })] }));
    expect(control).toMatchObject({ kind: 'linked', rung: 4, activityId: activityOf(raw.activities, 'bash-worktree', 'toolu_q1', OTHER)!.activityId });
  });
  it('the name never links: an activity whose upstream id equals the name, with no meta, is still `unmeasured`', () => {
    const w = world([subagentStart(1, AGENT)]);
    const v = correlateDelegation(input({ record: record({ adminRecord: `agent-${AGENT}`, canonicalPath: WT('x') }), activities: w.activities, acceptedEvidence: w.acceptedEvidence }));
    expect(v.kind).toBe('unmeasured');
  });
  it('a name that merely CONTAINS agent- or wf_ is not routed to rung 2', () => {
    for (const name of ['my-agent-wt', 'xwf_1-1', 'Agent-1', 'WF_1-1']) {
      expect(correlateDelegation(bait(name, 'rung4')).kind, name).toBe('linked');
    }
  });
});

describe('exact-path mismatch (W3-M44)', () => {
  it.each([
    ['a trailing slash', (p: string) => p + '/'],
    ['a different directory', () => '/fixture/project-a/.claude/worktrees/agent-other'],
    ['a case change', (p: string) => p.toUpperCase()],
    ['a prefix of it', (p: string) => p.slice(0, -1)],
    ['a parent of it', (p: string) => path.dirname(p)],
    ['an empty path', () => ''],
    ['a relative spelling', (p: string) => path.relative('/fixture', p)],
  ])('a meta whose worktreePath is %s does not link and is `unmeasured` (the name never decides)', (_label, mutate) => {
    const { m, base } = agentWorld();
    const v = correlateDelegation({ ...base, pointMetas: [{ ...m, worktreePath: mutate(m.worktreePath) }] });
    expect(v.kind).toBe('unmeasured');
    expect(v.kind === 'unmeasured' && v.reason).toBe('rung-2-path-mismatch');
  });
  it('the exact path links; it is the only spelling that does', () => {
    expect(correlateDelegation(agentWorld().base).kind).toBe('linked');
  });
});

describe('duplicate parent evidence: the same upstream id in two sessions is conflicting', () => {
  it('two parents with a joined activity for the same agent id', () => {
    const w = world([subagentStart(1, AGENT), subagentStart(2, AGENT, { sessionId: OTHER })]);
    const v = correlateDelegation(input({ activities: w.activities, acceptedEvidence: w.acceptedEvidence, pointMetas: [meta({ evidenceJournalId: w.records[0]!.journalId })] }));
    expect(v.kind).toBe('conflicting');
    expect(v.kind === 'conflicting' && v.reason).toBe('same-upstream-id-in-multiple-sessions');
    expect(v.evidenceJournalIds).toEqual(expect.arrayContaining(w.records.map((r) => r.journalId)));
  });
  it('one parent has the activity and the other only a meta naming the id', () => {
    const { w, base } = agentWorld();
    const v = correlateDelegation({ ...base, pointMetas: [...base.pointMetas, meta({ parentId: OTHER, evidenceJournalId: w.records[0]!.journalId })] });
    expect(v.kind).toBe('conflicting');
  });
  it('one parent has the activity and the other only a launch response naming the id in accepted evidence', () => {
    const w = world([subagentStart(1, AGENT), subagentStop(2, AGENT), agentLaunch(3, AGENT, 'async-launched', { sessionId: OTHER })]);
    const act = w.activities.filter((a) => a.parentId === PARENT);
    const v = correlateDelegation(input({ activities: act, acceptedEvidence: w.acceptedEvidence, pointMetas: [meta({ evidenceJournalId: w.records[0]!.journalId })] }));
    expect(v.kind).toBe('conflicting');
  });
  it('the same id under two incarnations of one ccd id is two parents', () => {
    const w = world([subagentStart(1, AGENT), subagentStart(2, AGENT, { parentIncarnation: 'g2' })]);
    const v = correlateDelegation(input({ activities: w.activities, acceptedEvidence: w.acceptedEvidence, pointMetas: [meta({ evidenceJournalId: w.records[0]!.journalId })] }));
    expect(v.kind).toBe('conflicting');
  });
  it('a workflow worker claimed by two parents is conflicting', () => {
    const WF = 'wf_run1-1';
    const w = world([workflowLaunch(1, 'wf_run1'), workflowLaunch(2, 'wf_run1', 'async-launched', { sessionId: OTHER })]);
    w.builder.openWorkflowWorkerFromMeta(PARENT, INC, 'wf_run1', 1);
    w.builder.openWorkflowWorkerFromMeta(OTHER, INC, 'wf_run1', 1);
    const v = correlateDelegation(input({
      record: record({ adminRecord: WF, canonicalPath: WT(WF) }), activities: w.builder.build(1).activities, acceptedEvidence: w.acceptedEvidence,
      pointMetas: [meta({ sourceKind: 'workflow', upstreamId: WF, worktreePath: WT(WF), evidenceJournalId: w.records[0]!.journalId })],
    }));
    expect(v.kind).toBe('conflicting');
  });
  it('a bare event from another session naming the id is NOT a claim (it is retained evidence, not a join)', () => {
    const { base, w } = agentWorld();
    const stray = world([bareTool(1, AGENT, { sessionId: OTHER })]);
    const v = correlateDelegation({ ...base, acceptedEvidence: [...w.acceptedEvidence, ...stray.acceptedEvidence] });
    expect(v.kind).toBe('linked');
  });
  it('rung 3: an agent id claimed by another session means the subagent\'s own path does not link; the answer is conflicting', () => {
    const rec = rawRecord();
    const w = world([
      subagentStart(1, AGENT), subagentStart(2, AGENT, { sessionId: OTHER }),
      { ...base(3, { cwd: WT(RAW) }), eventKind: 'PostToolUse', toolName: 'Bash', toolUseId: 'toolu_3', outcome: 'completed', agentId: AGENT },
    ]);
    const v = correlateDelegation(input({ record: rec, activities: w.activities, acceptedEvidence: w.acceptedEvidence }));
    expect(v.kind).toBe('conflicting');
  });
  it('rung 3: two parents\' subagents both inside the path are conflicting; two subagents of ONE parent are only unresolved', () => {
    const rec = rawRecord();
    const toolAt = (n: number, agentId: string, over: Over = {}): DelegationEventEnvelopeV1 =>
      ({ ...base(n, { ...over, cwd: WT(RAW) }), eventKind: 'PostToolUse', toolName: 'Bash', toolUseId: `toolu_${n}`, outcome: 'completed', agentId });
    const two = world([subagentStart(1, AGENT), subagentStart(2, AGENT_2, { sessionId: OTHER }), toolAt(3, AGENT), toolAt(4, AGENT_2, { sessionId: OTHER })]);
    expect(correlateDelegation(input({ record: rec, activities: two.activities, acceptedEvidence: two.acceptedEvidence })).kind).toBe('conflicting');
    const same = world([subagentStart(1, AGENT), subagentStart(2, AGENT_2), toolAt(3, AGENT), toolAt(4, AGENT_2)]);
    expect(correlateDelegation(input({ record: rec, activities: same.activities, acceptedEvidence: same.acceptedEvidence })).kind).toBe('unresolved');
  });
});

describe('conflict finality (W3-M46): a conflict is final, and no rung\'s link overrides another\'s disagreement', () => {
  const rec = rawRecord();
  const toolAt = (n: number, agentId: string): DelegationEventEnvelopeV1 =>
    ({ ...base(n, { cwd: WT(RAW) }), eventKind: 'PostToolUse', toolName: 'Bash', toolUseId: `toolu_${n}`, outcome: 'completed', agentId });
  it('rung 3 and rung 4 each link an activity of a DIFFERENT parent: conflicting, not the first and not the last', () => {
    const w = world([
      subagentStart(1, AGENT), toolAt(2, AGENT),
      bashPre(10, 'toolu_b1', ['main-wt'], { sessionId: OTHER }), bashPost(12, 'toolu_b1', ['main-wt', RAW], { sessionId: OTHER }),
    ]);
    const v = correlateDelegation(input({ record: rec, activities: w.activities, acceptedEvidence: w.acceptedEvidence, listingWindows: [win({ sessionId: OTHER, after: ['main-wt', RAW] })] }));
    expect(v.kind).toBe('conflicting');
    expect(v.kind === 'conflicting' && v.reason).toBe('rungs-disagree');
    expect(v.evidenceJournalIds).toEqual(sorted(w.records.map((r) => r.journalId)));
  });
  it('rung 3 and rung 4 naming the SAME parent agree: the link is the lowest rung\'s activity, with both rungs\' proof', () => {
    // the subagent\'s own cwd is the path AND its parent\'s Bash call added the record: one parent, two witnesses
    const w = world([subagentStart(1, AGENT), toolAt(2, AGENT), bashPre(10, 'toolu_b1', ['main-wt']), bashPost(12, 'toolu_b1', ['main-wt', RAW])]);
    const v = correlateDelegation(input({ record: rec, activities: w.activities, acceptedEvidence: w.acceptedEvidence, listingWindows: [win({ after: ['main-wt', RAW] })] }));
    expect(v).toEqual({
      kind: 'linked', activityId: activityOf(w.activities, 'agent', AGENT)!.activityId, rung: 3,
      evidenceJournalIds: sorted(w.records.map((r) => r.journalId)),
    });
  });
  it('a conflict at rung 3 is not overridden by a clean link at rung 4', () => {
    const w = world([
      subagentStart(1, AGENT), subagentStart(2, AGENT, { sessionId: OTHER }), toolAt(3, AGENT),
      bashPre(10, 'toolu_b1', ['main-wt']), bashPost(12, 'toolu_b1', ['main-wt', RAW]),
    ]);
    const v = correlateDelegation(input({ record: rec, activities: w.activities, acceptedEvidence: w.acceptedEvidence, listingWindows: [win({ after: ['main-wt', RAW] })] }));
    expect(v.kind).toBe('conflicting');
  });
  it('two metas of one agent naming different paths conflict, even when one of them is the canonical path', () => {
    const { m, base } = agentWorld();
    const v = correlateDelegation({ ...base, pointMetas: [m, { ...m, worktreePath: WT('somewhere-else') }] });
    expect(v.kind).toBe('conflicting');
    expect(v.kind === 'conflicting' && v.reason).toBe('meta-paths-disagree');
  });
  it('two metas that AGREE (one transcript folder under two homes) are one piece of evidence, not a conflict', () => {
    const { m, base } = agentWorld();
    expect(correlateDelegation({ ...base, pointMetas: [m, { ...m }] }).kind).toBe('linked');
  });
  it('a linked rung 4 beside a merely unresolved rung 3 is a link (a linked answer decides)', () => {
    const w = world([bashPre(10, 'toolu_b1', ['main-wt']), bashPost(12, 'toolu_b1', ['main-wt', RAW]), subagentStart(20, AGENT), subagentStart(21, AGENT_2), toolAt(22, AGENT), toolAt(23, AGENT_2)]);
    const v = correlateDelegation(input({ record: rec, activities: w.activities, acceptedEvidence: w.acceptedEvidence, listingWindows: [win({ after: ['main-wt', RAW] })] }));
    expect(v.kind).toBe('linked');
    expect(v.kind === 'linked' && v.rung).toBe(4);
  });
});

describe('overlapping listing windows are unresolved (W3-M47)', () => {
  it('an overlapping window of another session on the same repository, with any contents, makes the delta unresolved', () => {
    const w = world([bashPre(10, 'toolu_b1', ['main-wt']), bashPost(12, 'toolu_b1', ['main-wt', RAW])]);
    for (const contents of [{ before: [], after: [] }, { before: ['main-wt'], after: ['main-wt', 'wt-other'] }, { before: ['main-wt'], after: ['main-wt', RAW] }]) {
      const other = win({ sessionId: OTHER, toolUseId: 'toolu_o1', startedAt: T(9), endedAt: T(11), ...contents });
      const v = correlateDelegation(input({ record: rawRecord(), activities: w.activities, acceptedEvidence: w.acceptedEvidence, listingWindows: [win({ after: ['main-wt', RAW] }), other] }));
      expect(v.kind).toBe('unresolved');
      expect(v.kind === 'unresolved' && v.reason).toBe('overlapping-listing-window');
    }
  });
});

describe('a listing window whose repository the caller cannot name (final review I-1): it vetoes like a window on every repository', () => {
  const rec = rawRecord();
  const bashWorld = () => world([bashPre(10, 'toolu_b1', ['main-wt']), bashPost(12, 'toolu_b1', ['main-wt', RAW])]);
  const decide = (windows: readonly DelegationListingWindow[], extra: Partial<DelegationCorrelationInput> = {}, w = bashWorld()) =>
    correlateDelegation(input({ record: rec, activities: w.activities, acceptedEvidence: w.acceptedEvidence, listingWindows: windows, ...extra }));
  const mine = win({ after: ['main-wt', RAW] });                                                      // [T10, T12]
  const unknown = (over: Partial<DelegationListingWindow> = {}): DelegationListingWindow =>
    win({ sessionId: OTHER, toolUseId: 'toolu_o1', repository: null, startedAt: T(11), endedAt: T(13), before: ['main-wt'], after: ['main-wt'], ...over });

  it('SAFETY: overlapping a candidate in time makes the tree unresolved, as a window on the same repository would; never a link', () => {
    const v = decide([mine, unknown()]);
    expect(v.kind === 'unresolved' && v.reason).toBe('overlapping-listing-window');
    expect(decide([mine, unknown({ repository: 'project-b' })]).kind, 'CONTROL: a window on ANOTHER named repository does not veto').toBe('linked');
  });

  it('SAFETY: under a horizon, an open-ended or early unknown window keeps the link unmeasured, as one on the same repository would', () => {
    const late = (ms: number): string => formatDelegationInstant(Date.parse(T(0)) + ms);
    const far = win({ startedAt: late(DELEGATION_EVIDENCE_MARGIN_MS + 60_000), endedAt: late(DELEGATION_EVIDENCE_MARGIN_MS + 61_000), after: ['main-wt', RAW] });
    expect(decide([far], { evidenceHorizon: T(0) }).kind, 'CONTROL: alone, a candidate past the margin links').toBe('linked');
    // open-ended (begun after the candidate ended, so no overlap), and one begun before the horizon
    for (const w of [unknown({ startedAt: late(DELEGATION_EVIDENCE_MARGIN_MS + 120_000), endedAt: null, after: null }), unknown({ startedAt: T(-5), endedAt: T(-4) })]) {
      const v = decide([far, w], { evidenceHorizon: T(0) });
      expect(v.kind === 'unmeasured' && v.reason).toBe('evidence-horizon');
    }
  });

  it('LIVENESS: an unknown window that does not overlap the candidate in time leaves the link possible', () => {
    expect(decide([mine, unknown({ startedAt: T(13), endedAt: T(14) })]).kind).toBe('linked');
  });

  it('an unknown window is never a candidate: its own delta links nothing, even alone', () => {
    const w = world([bashPre(10, 'toolu_b1', ['main-wt'], { sessionId: OTHER }), bashPost(12, 'toolu_b1', ['main-wt', RAW], { sessionId: OTHER })]);
    const v = decide([unknown({ toolUseId: 'toolu_b1', startedAt: T(10), endedAt: T(12), after: ['main-wt', RAW] })], {}, w);
    expect(v.kind).not.toBe('linked');
  });

  it('delegationUnknownWindowForced counts a verdict an unknown window changed, and nothing else', () => {
    const ask = (windows: readonly DelegationListingWindow[]) => { const i = input({ record: rec, activities: bashWorld().activities, acceptedEvidence: bashWorld().acceptedEvidence, listingWindows: windows }); return delegationUnknownWindowForced(i, correlateDelegation(i)); };
    expect(ask([mine, unknown()]), 'it held the link back').toBe(true);
    expect(ask([mine]), 'none held').toBe(false);
    expect(ask([mine, unknown({ startedAt: T(13), endedAt: T(14) })]), 'a link').toBe(false);
    expect(ask([mine, unknown(), win({ sessionId: OTHER, toolUseId: 'toolu_o2', startedAt: T(11), endedAt: T(13), before: ['main-wt'], after: ['main-wt'] })]), 'a known window vetoes by itself').toBe(false);
  });
});

// ── 2c (R84; coordinator 5477, 5484): lost evidence never decides a link ─────────────────────────────────────────────

describe('2c (R84): a lost window, a lost hour or a lost creator never decides a link', () => {
  const rec = rawRecord();
  const MARGIN = DELEGATION_EVIDENCE_MARGIN_MS;
  const bashWorld = () => world([bashPre(10, 'toolu_b1', ['main-wt']), bashPost(12, 'toolu_b1', ['main-wt', RAW])]);
  const decide = (windows: readonly DelegationListingWindow[], extra: Partial<DelegationCorrelationInput> = {}, w = bashWorld()) =>
    correlateDelegation(input({ record: rec, activities: w.activities, acceptedEvidence: w.acceptedEvidence, listingWindows: windows, ...extra }));
  const mine = win({ after: ['main-wt', RAW] });                                                      // [T10, T12]
  /** A window whose listings were LOST (a shed listing, an unmeasured hour): it says when a call may have run, never what it listed. */
  const lost = (over: Partial<DelegationListingWindow> = {}): DelegationListingWindow =>
    win({ sessionId: OTHER, toolUseId: 'toolu_o1', startedAt: T(11), endedAt: T(13), before: [], after: null, lost: true, ...over });
  const answer = (v: DelegationCorrelationVerdict): string => (v.kind === 'linked' ? `linked:${v.rung}` : v.kind === 'run-child-owned' ? v.kind : `${v.kind}:${v.reason}`);

  it('step 1: a lost window that may be on the repository and overlaps the candidate makes it unmeasured(evidence-horizon), never a link', () => {
    for (const [label, w] of [
      ['another session', lost()],
      ['the SAME session (its subagent\'s call)', lost({ sessionId: PARENT, toolUseId: 'toolu_s1' })],
      ['a repository nobody can name', lost({ repository: null })],
      ['a listing nobody can attribute, filed under another project', lost({ repository: 'project-b', listedRepository: null })],
      ['a lost HOUR (no call, an empty toolUseId), open-ended', lost({ toolUseId: '', startedAt: T(0), endedAt: null })],
    ] as const) {
      expect(answer(decide([mine, w])), label).toBe('unmeasured:evidence-horizon');
    }
    expect(answer(decide([mine, lost({ startedAt: T(13), endedAt: T(14) })])), 'CONTROL: disjoint in time').toBe('linked:4');
    expect(answer(decide([mine, lost({ repository: 'project-b' })])), 'CONTROL: on another repository').toBe('linked:4');
    expect(answer(decide([mine, lost({ sessionId: PARENT, toolUseId: 'toolu_b1' })])), 'CONTROL: the candidate\'s own call is not its own lost window').toBe('linked:4');
  });

  it('step 1: a lost window is never a candidate: its listings mean nothing, even when they read as the one-record delta', () => {
    expect(decide([win({ after: ['main-wt', RAW], lost: true })]).kind).not.toBe('linked');
  });

  it('step 1, liveness: the horizon\'s held-window clause does not count a lost window: it vetoes only what it overlaps', () => {
    const late = (ms: number): string => formatDelegationInstant(Date.parse(T(0)) + ms);
    const far = win({ startedAt: late(MARGIN + 60_000), endedAt: late(MARGIN + 61_000), after: ['main-wt', RAW] });
    expect(answer(decide([far, lost({ startedAt: T(-5), endedAt: T(-4) })], { evidenceHorizon: T(0) })), 'begun before the horizon').toBe('linked:4');
    expect(answer(decide([far, lost({ startedAt: late(MARGIN + 120_000), endedAt: null })], { evidenceHorizon: T(0) })), 'open-ended, after the candidate').toBe('linked:4');
  });

  it('step 1: an unknown-repository window that is LOST is counted as lost evidence, not as the I-1 `window` kind', () => {
    const w = bashWorld();
    const i = input({ record: rec, activities: w.activities, acceptedEvidence: w.acceptedEvidence, listingWindows: [mine, lost({ repository: null })] });
    const v = correlateDelegation(i);
    expect(answer(v)).toBe('unmeasured:evidence-horizon');
    expect(delegationUnknownWindowForced(i, v)).toBe(false);
    expect(delegationLostEvidenceForced(i, v)).toBe(true);
  });

  it('E2: a same-session window that overlaps the candidate and whose added set CONTAINS the record is ambiguous, never a link to the first call', () => {
    const sub = (e: DelegationEventEnvelopeV1): DelegationEventEnvelopeV1 => ({ ...e, agentId: 'sub1' });
    const w = world([bashPre(10, 'toolu_b1', ['main-wt']), bashPost(12, 'toolu_b1', ['main-wt', RAW]),
      sub(bashPre(11, 'toolu_s1', ['main-wt'])), sub(bashPost(13, 'toolu_s1', ['main-wt', RAW, 'wt-x']))]);
    const subWindow = (over: Partial<DelegationListingWindow>): DelegationListingWindow =>
      win({ toolUseId: 'toolu_s1', startedAt: T(11), endedAt: T(13), after: ['main-wt', RAW, 'wt-x'], ...over });
    expect(answer(decide([mine, subWindow({})], {}, w))).toBe('unresolved:ambiguous-listing-windows');
    expect(answer(decide([mine, subWindow({ after: ['main-wt', 'wt-x'] })], {}, w)), 'CONTROL: it did not add the record').toBe('linked:4');
    expect(answer(decide([mine, subWindow({ startedAt: T(20), endedAt: T(22) })], {}, w)), 'CONTROL: it does not overlap').toBe('linked:4');
  });

  it('R85 (B-F2): a same-session OPEN-ENDED window over the candidate may be the call that made the tree (its after-listing is unknown): ambiguous, never a link naming either call', () => {
    const w = world([bashPre(9, 'toolu_s1', ['main-wt']), bashPre(10, 'toolu_b1', ['main-wt']), bashPost(12, 'toolu_b1', ['main-wt', RAW])]);
    const open = (over: Partial<DelegationListingWindow>): DelegationListingWindow => win({ toolUseId: 'toolu_s1', startedAt: T(9), endedAt: null, after: null, ...over });
    expect(answer(decide([mine, open({})], {}, w))).toBe('unresolved:ambiguous-listing-windows');
    expect(answer(decide([mine, open({ startedAt: T(13) })], {}, w)), 'CONTROL: begun after the candidate ended').toBe('linked:4');
  });

  it('d: a window may be on its session\'s project OR the repository its cwd is attributed to (`listedRepository`; null is every repository)', () => {
    const other = (over: Partial<DelegationListingWindow>): DelegationListingWindow =>
      win({ sessionId: OTHER, toolUseId: 'toolu_o1', startedAt: T(11), endedAt: T(13), before: ['main-wt'], after: ['main-wt'], ...over });
    expect(answer(decide([mine, other({ repository: 'project-b', listedRepository: REPO })])), 'filed under another project, listing this one').toBe('unresolved:overlapping-listing-window');
    expect(answer(decide([mine, other({ repository: 'project-b', listedRepository: null })])), 'a listing nobody can attribute').toBe('unresolved:overlapping-listing-window');
    expect(answer(decide([mine, other({ repository: REPO, listedRepository: 'project-b' })])), 'its session\'s own project still counts').toBe('unresolved:overlapping-listing-window');
    expect(answer(decide([mine, other({ repository: 'project-b', listedRepository: 'project-b' })])), 'CONTROL: both another').toBe('linked:4');
    expect(answer(decide([mine, other({ repository: 'project-b' })])), 'CONTROL: no listed repository is today\'s rule').toBe('linked:4');
    // the horizon's held-window clause asks the same question
    const late = (ms: number): string => formatDelegationInstant(Date.parse(T(0)) + ms);
    const far = win({ startedAt: late(MARGIN + 60_000), endedAt: late(MARGIN + 61_000), after: ['main-wt', RAW] });
    expect(answer(decide([far, other({ repository: 'project-b', listedRepository: REPO, startedAt: T(-5), endedAt: T(-4) })], { evidenceHorizon: T(0) }))).toBe('unmeasured:evidence-horizon');
    // a window filed under another project is never a candidate here, whatever its listing
    expect(decide([win({ repository: 'project-b', listedRepository: REPO, after: ['main-wt', RAW] })]).kind).not.toBe('linked');
  });

  describe('X1: a lost creator never leaves a rung-3 link standing', () => {
    // P's subagent works at the path (rung 3); Q's Bash call [T10, T12] created it (rung 4). Held in full the two disagree, final.
    const toolAt = (n: number): DelegationEventEnvelopeV1 =>
      ({ ...base(n, { cwd: WT(RAW) }), eventKind: 'PostToolUse', toolName: 'Bash', toolUseId: `toolu_${n}`, outcome: 'completed', agentId: AGENT });
    const pEvents = [subagentStart(1, AGENT, { cwd: '/elsewhere' }), toolAt(2)];
    const all = world([...pEvents, bashPre(10, 'toolu_q1', ['main-wt'], { sessionId: OTHER }), bashPost(12, 'toolu_q1', ['main-wt', RAW], { sessionId: OTHER })]);
    const qWindow = win({ sessionId: OTHER, toolUseId: 'toolu_q1' });
    /** The tree was first listed at T(60); the census before it, at T(0), did not list it. */
    const SIGHTED = { after: T(0), at: T(60) };
    const decideX = (over: Partial<DelegationCorrelationInput>, w = all): DelegationCorrelationVerdict =>
      correlateDelegation(input({ record: rec, activities: w.activities, acceptedEvidence: w.acceptedEvidence.slice(0, 2), listingWindows: [], firstSighting: SIGHTED, ...over }));
    /** `s` seconds before the bracket's lower end: the census that did not list the tree, less a margin and the clock skew allowance. */
    const before = (s: number): string => formatDelegationInstant(Date.parse(T(0)) - MARGIN - DELEGATION_CLOCK_SKEW_MS - s * 1000);
    /** After the bracket's upper end: the first census that listed it, plus the clock skew allowance. */
    const AFTER = { startedAt: T(60 + DELEGATION_CLOCK_SKEW_MS / 1000 + 10), endedAt: T(60 + DELEGATION_CLOCK_SKEW_MS / 1000 + 20) };

    it('Q\'s window EVICTED (the horizon at its PostToolUse, inside the bracket): unmeasured, never P\'s rung-3 link. Held in full it is the final conflict; with nothing lost rung 3 links', () => {
      expect(answer(decideX({ acceptedEvidence: all.acceptedEvidence, listingWindows: [qWindow] })), 'held in full').toBe('conflicting:rungs-disagree');
      expect(answer(decideX({ evidenceHorizon: T(12) })), 'Q evicted').toBe('unmeasured:evidence-horizon');
      expect(answer(decideX({})), 'CONTROL: nothing lost, nothing hides a creator').toBe('linked:3');
      expect(answer(decideX({ evidenceHorizon: before(1) })), 'CONTROL: evicted only before the bracket').toBe('linked:3');
    });

    it('the horizon arm\'s boundary is closed: a horizon AT one margin (and the clock skew allowance) before the census that did not list the tree reaches the bracket', () => {
      expect(answer(decideX({ evidenceHorizon: before(0) }))).toBe('unmeasured:evidence-horizon');
      expect(answer(decideX({ evidenceHorizon: formatDelegationInstant(Date.parse(before(0)) - 1) }))).toBe('linked:3');
    });

    it('Q\'s listings SHED or its hour LOST (a lost window that may be on the repository, inside the bracket): unmeasured', () => {
      expect(answer(decideX({ listingWindows: [lost({ toolUseId: 'toolu_q1', startedAt: T(10), endedAt: T(12) })] })), 'shed').toBe('unmeasured:evidence-horizon');
      expect(answer(decideX({ listingWindows: [lost({ toolUseId: '', startedAt: T(-3600), endedAt: T(1200), repository: null })] })), 'a lost hour').toBe('unmeasured:evidence-horizon');
      expect(answer(decideX({ listingWindows: [lost({ startedAt: before(20), endedAt: before(10) })] })), 'CONTROL: lost only before the bracket').toBe('linked:3');
      expect(answer(decideX({ listingWindows: [lost(AFTER)] })), 'CONTROL: lost only after the first sighting').toBe('linked:3');
      expect(answer(decideX({ listingWindows: [lost({ startedAt: T(70), endedAt: T(80) })] })), 'inside the clock skew allowance after it').toBe('unmeasured:evidence-horizon');
      expect(answer(decideX({ listingWindows: [lost({ repository: 'project-b' })] })), 'CONTROL: lost on another repository').toBe('linked:3');
    });

    it('5484 (3): a LOST first-sighting instant (after a restart) is not an empty one: (-inf, at], so any lost evidence that may be on the repository keeps the link unmeasured', () => {
      const unknown = { after: null, at: T(60) };
      expect(answer(decideX({ firstSighting: unknown, evidenceHorizon: before(100_000) })), 'an eviction long before').toBe('unmeasured:evidence-horizon');
      expect(answer(decideX({ firstSighting: unknown, listingWindows: [lost({ startedAt: before(100_000), endedAt: before(99_000), repository: null })] })), 'a lost hour long before').toBe('unmeasured:evidence-horizon');
      expect(answer(decideX({ firstSighting: unknown })), 'CONTROL: nothing lost at all').toBe('linked:3');
      expect(answer(decideX({ firstSighting: unknown, listingWindows: [lost(AFTER)] })), 'CONTROL: lost only after the first sighting').toBe('linked:3');
    });

    it('a first-sighting instant that is not canonical fails safe: any lost evidence keeps the link unmeasured', () => {
      for (const firstSighting of [{ after: 'yesterday', at: T(60) }, { after: T(0), at: '' }]) {
        expect(answer(decideX({ firstSighting, evidenceHorizon: before(100_000) })), JSON.stringify(firstSighting)).toBe('unmeasured:evidence-horizon');
      }
    });

    it('X1 decides nothing by itself: a tree with no rung-3 link keeps the answer it had (the module only ever makes a LINK less decided)', () => {
      const none = world([bashPre(10, 'toolu_q1', ['main-wt'], { sessionId: OTHER }), bashPost(12, 'toolu_q1', ['main-wt', RAW], { sessionId: OTHER })]);
      const v = decideX({ evidenceHorizon: T(12), acceptedEvidence: [] }, none);
      expect(answer(v)).toBe('unresolved:no-correlating-evidence');
      expect(answer(decideX({ evidenceHorizon: T(12) })), 'beside a link it is the link that yields').toBe('unmeasured:evidence-horizon');
    });

    it('R85 (B-F1): a HELD creator window that cannot be a candidate because its evidence is missing is lost evidence: open-ended (its PostToolUse never came: a lost Post), or of a session whose project was lost at a restart (a null repository) and adding the record', () => {
      const qPreOnly = world([...pEvents, bashPre(10, 'toolu_q1', ['main-wt'], { sessionId: OTHER })]);
      expect(answer(decideX({ acceptedEvidence: qPreOnly.acceptedEvidence, listingWindows: [win({ sessionId: OTHER, toolUseId: 'toolu_q1', endedAt: null, after: null })] }, qPreOnly)),
        'open-ended: the lost Post').toBe('unmeasured:evidence-horizon');
      expect(answer(decideX({ acceptedEvidence: all.acceptedEvidence, listingWindows: [{ ...qWindow, repository: null }] })), 'the restart route: a null repository').toBe('unmeasured:evidence-horizon');
      expect(answer(decideX({ acceptedEvidence: all.acceptedEvidence, listingWindows: [qWindow] })), 'CONTROL: held in full, the final conflict').toBe('conflicting:rungs-disagree');
      const i = input({ record: rec, activities: all.activities, acceptedEvidence: all.acceptedEvidence, listingWindows: [{ ...qWindow, repository: null }], firstSighting: SIGHTED });
      expect(delegationLostEvidenceForced(i, correlateDelegation(i)), 'counted as lost evidence').toBe(true);
    });

    it('R85 (B-F1), liveness: the clause is exactly that narrow: a held window that is closed and does NOT add the record, one that began before the bracket, and one on another repository leave rung 3 linking', () => {
      const qPreOnly = world([...pEvents, bashPre(10, 'toolu_q1', ['main-wt'], { sessionId: OTHER })]);
      const open = (over: Partial<DelegationListingWindow>): DelegationListingWindow => win({ sessionId: OTHER, toolUseId: 'toolu_q1', endedAt: null, after: null, ...over });
      expect(answer(decideX({ acceptedEvidence: qPreOnly.acceptedEvidence, listingWindows: [open({})] }, qPreOnly)), 'the open-ended creator itself').toBe('unmeasured:evidence-horizon');
      for (const [label, w] of [
        ['closed, not adding the record', win({ sessionId: OTHER, toolUseId: 'toolu_o1', after: ['main-wt'] })],
        ['closed, a null repository, not adding the record', win({ sessionId: OTHER, toolUseId: 'toolu_o1', repository: null, after: ['main-wt'] })],
        ['closed, a null repository, adding ANOTHER record', win({ sessionId: OTHER, toolUseId: 'toolu_o1', repository: null, after: ['main-wt', 'wt-other'] })],
        ['open-ended, begun before the bracket (a call lasts at most the margin)', open({ startedAt: before(10) })],
        ['open-ended, begun after the first sighting', open({ startedAt: AFTER.startedAt })],
        ['open-ended, on another repository', open({ repository: 'project-b' })],
      ] as const) {
        expect(answer(decideX({ listingWindows: [w] })), label).toBe('linked:3');
      }
    });

    it('delegationLostEvidenceForced counts a link that lost evidence held back (a lost window, or X1), and nothing else', () => {
      const ask = (over: Partial<DelegationCorrelationInput>, w = all): boolean => {
        const i = input({ record: rec, activities: w.activities, acceptedEvidence: w.acceptedEvidence.slice(0, 2), listingWindows: [], firstSighting: SIGHTED, ...over });
        return delegationLostEvidenceForced(i, correlateDelegation(i));
      };
      expect(ask({ evidenceHorizon: T(12) }), 'X1, the horizon arm').toBe(true);
      expect(ask({ listingWindows: [lost({ toolUseId: 'toolu_q1', startedAt: T(10), endedAt: T(12) })] }), 'X1, a lost window').toBe(true);
      expect(ask({}), 'a link').toBe(false);
      expect(ask({ acceptedEvidence: all.acceptedEvidence, listingWindows: [qWindow] }), 'a held conflict').toBe(false);
      expect(ask({ droppedEvidence: DELEGATION_DROPPED_UNMEASURED }), 'an unmeasured index holds it, not a lost window').toBe(false);
      const b = bashWorld();
      const step1 = input({ record: rec, activities: b.activities, acceptedEvidence: b.acceptedEvidence, listingWindows: [mine, lost()] });
      expect(delegationLostEvidenceForced(step1, correlateDelegation(step1)), 'step 1, a lost window over the candidate').toBe(true);
      const held = input({ record: rec, activities: b.activities, acceptedEvidence: b.acceptedEvidence, listingWindows: [mine, lost(), win({ sessionId: OTHER, toolUseId: 'toolu_o2', startedAt: T(11), endedAt: T(13), before: [], after: [] })] });
      expect(delegationLostEvidenceForced(held, correlateDelegation(held)), 'a held overlap decides it without the lost window').toBe(false);
    });
  });
});

describe('the two-pass ccrc-birth wait (W3-M48)', () => {
  it.each([2, 1] as const)('with %i pass(es) remaining even PERFECT rung-2 evidence is `unresolved`: the tree may be a ccd workspace being born', (n) => {
    const v = correlateDelegation(agentWorld({ birthPassesRemaining: n }).base);
    expect(v.kind).toBe('unresolved');
    expect(v.kind === 'unresolved' && v.reason).toBe('ccrc-birth-wait');
  });
  it('with 0 passes remaining the same evidence links', () => {
    expect(correlateDelegation(agentWorld({ birthPassesRemaining: 0 }).base).kind).toBe('linked');
  });
  it('a registry row or .child that appears DURING the wait ends it as a ccd workspace, not as a link and not as a lease', () => {
    for (const over of [{ hasRegistryRow: true }, { hasChildMarker: true }]) {
      for (const n of [2, 1, 0] as const) {
        const v = correlateDelegation(agentWorld({ ...over, birthPassesRemaining: n }).base);
        expect(v.kind, `${JSON.stringify(over)} ${n}`).toBe('unresolved');
        expect(v.kind === 'unresolved' && v.reason).toBe('ccd-workspace-not-a-lease');
      }
    }
  });
  it('the wait applies to rungs 3 and 4 too', () => {
    const w = world([bashPre(10, 'toolu_b1', ['main-wt']), bashPost(12, 'toolu_b1', ['main-wt', RAW])]);
    const v = correlateDelegation(input({ record: rawRecord(), activities: w.activities, acceptedEvidence: w.acceptedEvidence, listingWindows: [win({ after: ['main-wt', RAW] })], birthPassesRemaining: 1 }));
    expect(v.kind).toBe('unresolved');
  });
});

describe('every forbidden heuristic (W3-M45): none of them links', () => {
  // A tree named `wt-raw` (reachable by rungs 3 and 4 only) and a world that tempts each heuristic in turn, with NO rung-3 or rung-4 evidence.
  const tree = rawRecord({ headBranch: 'worktree-agent-abc123def456' });
  const joined = world([subagentStart(1, AGENT), sessionStart(2)]);
  const run = (over: Partial<DelegationCorrelationInput> = {}): DelegationCorrelationVerdict =>
    correlateDelegation(input({ record: tree, activities: joined.activities, acceptedEvidence: joined.acceptedEvidence, ...over }));
  it('control: nothing tempting is present, and the answer is unresolved', () => {
    expect(run().kind).toBe('unresolved');
  });
  it('a display name equal to the admin record name', () => {
    const named = joined.activities.map((a) => ({ ...a, displayName: RAW }));
    expect(run({ activities: named }).kind).toBe('unresolved');
  });
  it('a name pattern: the admin record name embeds an activity\'s upstream id (but is not `agent-*`)', () => {
    const v = correlateDelegation(input({ record: rawRecord({ adminRecord: `x-${AGENT}`, canonicalPath: WT(`x-${AGENT}`) }), activities: joined.activities, acceptedEvidence: joined.acceptedEvidence }));
    expect(v.kind).toBe('unresolved');
  });
  it('a branch prefix: the head branch is `worktree-agent-<id>` of a live activity', () => {
    expect(run({ record: rawRecord({ headBranch: `worktree-agent-${AGENT}` }) }).kind).toBe('unresolved');
    expect(run({ record: rawRecord({ headBranch: `claude/${AGENT}` }) }).kind).toBe('unresolved');
  });
  it('a timestamp: the activity opened at the very instant the tree appeared (the census diagnostic names that instant)', () => {
    const v = run({ record: rawRecord({ diagnostic: `created ${T(1)}` }) });
    expect(v.kind).toBe('unresolved');
  });
  it('a server-census bracket: a window that closed just before the tree was first seen, delta of a DIFFERENT record', () => {
    const w = world([bashPre(10, 'toolu_b1', ['main-wt']), bashPost(12, 'toolu_b1', ['main-wt', 'wt-other'])]);
    const v = correlateDelegation(input({ record: tree, activities: w.activities, acceptedEvidence: w.acceptedEvidence, listingWindows: [win({ after: ['main-wt', 'wt-other'] })] }));
    expect(v.kind).toBe('unresolved');
  });
  it('directory nesting: the path sits under the cwd of the parent\'s or a subagent\'s events', () => {
    const nested = world([subagentStart(1, AGENT), { ...base(2, { cwd: `/fixture/${REPO}` }), eventKind: 'PostToolUse', toolName: 'Bash', toolUseId: 'toolu_2', outcome: 'completed', agentId: AGENT },
      { ...base(3, { cwd: `/fixture/${REPO}/.claude/worktrees` }), eventKind: 'PostToolUse', toolName: 'Bash', toolUseId: 'toolu_3', outcome: 'completed' }]);
    expect(correlateDelegation(input({ record: tree, activities: nested.activities, acceptedEvidence: nested.acceptedEvidence })).kind).toBe('unresolved');
  });
  it('process ancestry: the input has no ancestry field, and one smuggled onto the record changes nothing', () => {
    const smuggled = { ...tree, ppid: 4242, ancestry: [1, AGENT] } as unknown as DelegationCensusRecord;
    expect(Object.keys(input())).not.toContain('ancestry');
    expect(run({ record: smuggled })).toEqual(run());
  });
  it('the parent\'s own working directory: S\'s event with no agent id whose cwd IS the path', () => {
    const parentCwd = world([subagentStart(1, AGENT), { ...base(2, { cwd: WT(RAW) }), eventKind: 'PostToolUse', toolName: 'Bash', toolUseId: 'toolu_2', outcome: 'completed' }]);
    expect(correlateDelegation(input({ record: tree, activities: parentCwd.activities, acceptedEvidence: parentCwd.acceptedEvidence })).kind).toBe('unresolved');
  });
  it('a lone live activity and a lone unlinked tree are not "the only candidates": exclusivity links nothing', () => {
    expect(joined.activities).toHaveLength(1);
    expect(run().kind).toBe('unresolved');
  });
});

describe('every D-4008 fold (W3-M49, the correlation half): none is positive evidence', () => {
  const FOLDS: readonly [string, Partial<DelegationCensusRecord>][] = [
    ['locked false (a failed lock stat)', { locked: false }],
    ['locked true', { locked: true }],
    ['baseAgreesFirstLog null (an unreadable first log)', { baseAgreesFirstLog: null }],
    ['baseAgreesFirstLog true', { baseAgreesFirstLog: true }],
    ['baseAgreesFirstLog false', { baseAgreesFirstLog: false }],
    ['no head, no base', { headBranch: null, headSha: null, claudeBase: null }],
  ];
  it.each(FOLDS)('the verdict is identical whatever the record says about %s (a link stays a link, a non-link stays a non-link)', (_label, over) => {
    const linkable = agentWorld().base;
    const reference = correlateDelegation(linkable);
    expect(reference.kind).toBe('linked');
    expect(correlateDelegation({ ...linkable, record: { ...linkable.record, ...over } })).toEqual(reference);
    const bare = input({ record: rawRecord() });
    const bareRef = correlateDelegation(bare);
    expect(bareRef.kind).toBe('unresolved');
    expect(correlateDelegation({ ...bare, record: { ...bare.record, ...over } })).toEqual(bareRef);
  });
  it('an unreadable gitdir reads as an absent canonical path, and with exact-looking evidence it is `unmeasured`, never linked', () => {
    const { m, base } = agentWorld();
    for (const worktreePath of [m.worktreePath, '', 'null', 'undefined']) {
      const v = correlateDelegation({ ...base, record: { ...base.record, canonicalPath: null }, pointMetas: [{ ...m, worktreePath }] });
      expect(v.kind, worktreePath).toBe('unmeasured');
      expect(v.kind === 'unmeasured' && v.reason).toBe('canonical-path-unmeasured');
    }
  });
  it('an absent canonical path equals no cwd, even an absent one (`undefined == null` must not link)', () => {
    const noCwd: DelegationEventEnvelopeV1 = { ...base(2), eventKind: 'PostToolUse', toolName: 'Bash', toolUseId: 'toolu_2', outcome: 'completed', agentId: AGENT };
    const w = world([subagentStart(1, AGENT), noCwd]);
    const v = correlateDelegation(input({ record: rawRecord({ canonicalPath: null }), activities: w.activities, acceptedEvidence: w.acceptedEvidence }));
    expect(v.kind).toBe('unmeasured');
  });
  it('an unreadable record is `unmeasured` and an absent one is `unresolved`: the two are never folded into each other or into a link', () => {
    const base = agentWorld().base;
    const unreadable = correlateDelegation({ ...base, record: { ...base.record, state: 'unreadable', canonicalPath: null } });
    const absent = correlateDelegation({ ...base, record: { ...base.record, state: 'absent', canonicalPath: null } });
    expect(unreadable.kind).toBe('unmeasured');
    expect(unreadable.kind === 'unmeasured' && unreadable.reason).toBe('record-unreadable');
    expect(absent.kind).toBe('unresolved');
    expect(absent.kind === 'unresolved' && absent.reason).toBe('record-absent');
    // and the state decides even when the path is (stale-ly) present
    expect(correlateDelegation({ ...base, record: { ...base.record, state: 'unreadable' } }).kind).toBe('unmeasured');
    expect(correlateDelegation({ ...base, record: { ...base.record, state: 'absent' } }).kind).toBe('unresolved');
  });
});

describe('rung 3 refuses a cwd the parent itself reported (ruling R42, W3-M45\'s parent-cwd arm)', () => {
  // The measured `agent-plain` lane shape (fixtures/delegation/2.1.281/agent-plain.json): a NON-ISOLATED subagent inherits the parent's
  // working directory on every event it emits, SubagentStart and SubagentStop included. Here the parent sits in the raw worktree.
  const rec = rawRecord();
  const at = { cwd: WT(RAW) };
  const subBash = (n: number, agentId: string, kind: 'PreToolUse' | 'PostToolUse', over: Over = {}): DelegationEventEnvelopeV1 =>
    kind === 'PreToolUse'
      ? { ...base(n, over), eventKind: 'PreToolUse', toolName: 'Bash', toolUseId: `toolu_${n}`, agentId }
      : { ...base(n, over), eventKind: 'PostToolUse', toolName: 'Bash', toolUseId: `toolu_${n}`, outcome: 'completed', agentId };
  const plain = (extra: readonly DelegationEventEnvelopeV1[] = []): DelegationEventEnvelopeV1[] => [
    sessionStart(1, at), { ...base(2, at), eventKind: 'PreToolUse', toolName: 'Agent', toolUseId: 'toolu_2', isolation: null },
    subagentStart(3, AGENT, at, 'general-purpose'), agentLaunch(4, AGENT, 'async-launched', at),
    subBash(5, AGENT, 'PreToolUse', at), subBash(6, AGENT, 'PostToolUse', at), subagentStop(7, AGENT, at), ...extra,
  ];
  it('the measured agent-plain shape is NOT a link: the answer is the closed refusal `parent-cwd`', () => {
    const w = world(plain());
    expect(w.activities).toHaveLength(1);                                       // the subagent IS a joined activity, which is what makes this a trap
    const v = correlateDelegation(input({ record: rec, activities: w.activities, acceptedEvidence: w.acceptedEvidence }));
    expect(v.kind).toBe('unresolved');
    expect(v.kind === 'unresolved' && v.reason).toBe('parent-cwd');
    expect(DELEGATION_CORRELATION_REASONS).toContain('parent-cwd');
  });
  it('with rung 4 firing for the SAME parent the verdict follows rung 4 alone: never the subagent, and the subagent\'s records are not its proof', () => {
    const w = world(plain([bashPre(10, 'toolu_b1', ['main-wt'], at), bashPost(12, 'toolu_b1', ['main-wt', RAW], at)]));
    const v = correlateDelegation(input({ record: rec, activities: w.activities, acceptedEvidence: w.acceptedEvidence, listingWindows: [win({ after: ['main-wt', RAW] })] }));
    const bash = activityOf(w.activities, 'bash-worktree', 'toolu_b1')!;
    expect(v).toEqual({ kind: 'linked', activityId: bash.activityId, rung: 4, evidenceJournalIds: sorted([w.records[7]!.journalId, w.records[8]!.journalId]) });
  });
  it('with rung 4 firing for ANOTHER parent the parent-cwd rung 3 does not agree with it and does not conflict with it: rung 4 stands alone', () => {
    const w = world([...plain(), bashPre(10, 'toolu_b1', ['main-wt'], { sessionId: OTHER }), bashPost(12, 'toolu_b1', ['main-wt', RAW], { sessionId: OTHER })]);
    const v = correlateDelegation(input({ record: rec, activities: w.activities, acceptedEvidence: w.acceptedEvidence, listingWindows: [win({ sessionId: OTHER, after: ['main-wt', RAW] })] }));
    expect(v.kind).toBe('linked');
    expect(v.kind === 'linked' && v.rung).toBe(4);
    expect(v.kind === 'linked' && activityOf(w.activities, 'agent', AGENT)!.activityId).not.toBe(v.kind === 'linked' && v.activityId);
  });
  it('the parent\'s Agent PreToolUse alone (its cwd is the path) refuses a later subagent event at that path', () => {
    const w = world([{ ...base(1, at), eventKind: 'PreToolUse', toolName: 'Agent', toolUseId: 'toolu_1', isolation: null }, subagentStart(2, AGENT), subBash(3, AGENT, 'PostToolUse', at)]);
    expect(correlateDelegation(input({ record: rec, activities: w.activities, acceptedEvidence: w.acceptedEvidence })).kind).toBe('unresolved');
  });
  it('SubagentStart and SubagentStop at the path are not "emitted from inside" the subagent: with no other event they place nothing', () => {
    const w = world([subagentStart(1, AGENT, at), subagentStop(2, AGENT, at)]);
    const v = correlateDelegation(input({ record: rec, activities: w.activities, acceptedEvidence: w.acceptedEvidence }));
    expect(v.kind).toBe('unresolved');
    expect(v.kind === 'unresolved' && v.reason).toBe('no-correlating-evidence');
  });
  it('control: an ISOLATED subagent (its own cwd, the parent elsewhere) is still a rung-3 link', () => {
    const w = world([sessionStart(1, { cwd: `/fixture/${REPO}` }), subagentStart(2, AGENT, { cwd: `/fixture/${REPO}` }), subBash(3, AGENT, 'PostToolUse', at)]);
    const v = correlateDelegation(input({ record: rec, activities: w.activities, acceptedEvidence: w.acceptedEvidence }));
    expect(v.kind).toBe('linked');
    expect(v.kind === 'linked' && v.rung).toBe(3);
  });
  it('Task 11 N1: the conflict checks run BEFORE the veto: a vetoed parent\'s subagent and ANOTHER parent\'s isolated one at the path are a final conflict, not a retried parent-cwd', () => {
    const elsewhere = { cwd: `/fixture/${REPO}` };
    const w = world([
      sessionStart(1, at), subagentStart(2, AGENT), subBash(3, AGENT, 'PostToolUse', at),
      sessionStart(4, { ...elsewhere, sessionId: OTHER }), subagentStart(5, AGENT_2, { ...elsewhere, sessionId: OTHER }), subBash(6, AGENT_2, 'PostToolUse', { ...at, sessionId: OTHER }),
    ]);
    const v = correlateDelegation(input({ record: rec, activities: w.activities, acceptedEvidence: w.acceptedEvidence }));
    expect(v.kind === 'conflicting' && v.reason).toBe('path-claimed-by-multiple-parents');
  });
  it('the veto is the PARENT\'s: another incarnation\'s or another session\'s cwd does not veto this parent\'s subagent', () => {
    const w = world([sessionStart(1, { ...at, parentIncarnation: 'g2' }), sessionStart(2, { ...at, sessionId: OTHER }), subagentStart(3, AGENT), subBash(4, AGENT, 'PostToolUse', at)]);
    expect(correlateDelegation(input({ record: rec, activities: w.activities, acceptedEvidence: w.acceptedEvidence })).kind).toBe('linked');
  });
});

describe('a Workflow run\'s identity is checkpoint data, so a launch never pins pruning (ruling R44)', () => {
  const events = [workflowLaunch(1, 'wf_run1'), sessionStart(2), sessionStart(3), sessionStart(4)];
  const NO_FLOOR = Date.UTC(2100, 0, 1);
  const w = world(events);
  const runRow = activityOf(w.activities, 'workflow', 'wf_run1')!;

  it('applying the launch opens the run: a mapping and a row, with the launch record as its identity', () => {
    expect(runRow.identityJournalId).toBe(w.records[0]!.journalId);
    expect(runRow.activityId).toBe(deriveDelegationActivityId(keyOf('workflow', 'wf_run1'), w.records[0]!.journalId));
    expect(w.cp.activityIdsByNaturalKey[encodeDelegationNaturalKey(keyOf('workflow', 'wf_run1'))]).toBe(runRow.activityId);
  });
  it('no hold names the run\'s record, and the pruning plan may cut past it', () => {
    expect(w.cp.pruningHolds.map((h) => h.reason)).toEqual(['checkpoint-anchor']);
    const view = delegationRetentionViewOf(w.records, new Set(w.cp.pruningHolds.map((h) => h.journalId)), NO_FLOOR);
    const plan = planDelegationPruning({ state: w.report.state, view });
    expect(plan.prunableThroughSequence).toBe(3);                              // strictly before the anchor at 4: the launch at 1 is cuttable
  });
  it('a worker meta arriving after the launch record was PRUNED derives the same identity, from the checkpoint', () => {
    const bytes = encodeDelegationCheckpoint(w.cp);
    const pruned = recoverDelegation(bytes, w.records.slice(3));               // the journal now begins at the anchor
    expect(pruned.failure).toBeNull();
    const opened = pruned.facts!.builder.openWorkflowWorkerFromMeta(PARENT, INC, 'wf_run1', 1);
    expect(opened.kind).toBe('opened');
    const worker = activityOf(pruned.facts!.builder.build(1).activities, 'workflow', 'wf_run1-1')!;
    expect(worker.identityJournalId).toBe(w.records[0]!.journalId);
    // the run row and its mapping survived the cut of the launch record: they are checkpoint data
    expect(activityOf(pruned.state.checkpoint.activities, 'workflow', 'wf_run1')).toEqual(runRow);
    expect(pruned.state.checkpoint.activityIdsByNaturalKey).toEqual(w.cp.activityIdsByNaturalKey);
    const fresh = w.builder.clone();
    fresh.openWorkflowWorkerFromMeta(PARENT, INC, 'wf_run1', 1);
    expect(worker.activityId).toBe(activityOf(fresh.build(1).activities, 'workflow', 'wf_run1-1')!.activityId);
    expect(worker.activityId).toBe(deriveDelegationActivityId(keyOf('workflow', 'wf_run1-1'), w.records[0]!.journalId));
  });
  it('recovery from a checkpoint plus the retained suffix restores the same run identity', () => {
    const early = recoverDelegation(null, w.records.slice(0, 2)).state.checkpoint;           // the launch is covered; two more records follow
    expect(activityOf(early.activities, 'workflow', 'wf_run1')!.activityId).toBe(runRow.activityId);
    const resumed = recoverDelegation(encodeDelegationCheckpoint(early), w.records.slice(1));  // the journal from the checkpoint's anchor on
    expect(resumed.failure).toBeNull();
    expect(activityOf(resumed.state.checkpoint.activities, 'workflow', 'wf_run1')).toEqual(runRow);
    expect(resumed.state.checkpoint.activityIdsByNaturalKey).toEqual(w.cp.activityIdsByNaturalKey);
  });
  it('a worker takes the run\'s ended state: the launch that reported completed ends it at open', () => {
    const done = world([workflowLaunch(1, 'wf_run1', 'completed')]);
    done.builder.openWorkflowWorkerFromMeta(PARENT, INC, 'wf_run1', 0);
    expect(activityOf(done.builder.build(1).activities, 'workflow', 'wf_run1-0')!.executionState).toBe('ended');
  });
  it('the run row itself is not a rung-2 claimant for a worker\'s tree name', () => {
    const WF = 'wf_run1-1';
    const x = world([workflowLaunch(1, 'wf_run1')]);
    x.builder.openWorkflowWorkerFromMeta(PARENT, INC, 'wf_run1', 1);
    const v = correlateDelegation(input({
      record: record({ adminRecord: WF, canonicalPath: WT(WF) }), activities: x.builder.build(1).activities, acceptedEvidence: x.acceptedEvidence,
      pointMetas: [meta({ sourceKind: 'workflow', upstreamId: WF, worktreePath: WT(WF), evidenceJournalId: x.records[0]!.journalId })],
    }));
    expect(v.kind).toBe('linked');
    expect(v.kind === 'linked' && v.activityId).toBe(activityOf(x.builder.build(1).activities, 'workflow', WF)!.activityId);
  });
});

describe('openWorkflowWorkerFromMeta refuses an index a meta file cannot be trusted for (m1)', () => {
  it.each([[Number.NaN], [-1], [1.5], [Number.POSITIVE_INFINITY], [Number.MAX_SAFE_INTEGER + 1], ['1' as unknown as number], [null as unknown as number], [undefined as unknown as number]])(
    'index %s is refused and mints nothing', (index) => {
      const w = world([workflowLaunch(1, 'wf_run1')]);
      const before = w.builder.build(1);
      let code = 'accepted';
      try { w.builder.openWorkflowWorkerFromMeta(PARENT, INC, 'wf_run1', index); } catch (err) { code = err instanceof DelegationCheckpointError ? err.code : 'other'; }
      expect(code).toBe('bad-shape');
      expect(w.builder.build(1).activities).toEqual(before.activities);
      expect(w.builder.build(1).activityIdsByNaturalKey).toEqual(before.activityIdsByNaturalKey);
    });
  it.each([[0], [1], [Number.MAX_SAFE_INTEGER]])('index %s is accepted', (index) => {
    const w = world([workflowLaunch(1, 'wf_run1')]);
    expect(w.builder.openWorkflowWorkerFromMeta(PARENT, INC, 'wf_run1', index).kind).toBe('opened');
  });
  it('a listing-less Bash PreToolUse is skipped, so the PostToolUse that carries the listing is the identity (D-4649)', () => {
    const w = world([bashPre(1, 'toolu_b1'), bashPost(2, 'toolu_b1', ['main-wt', RAW])]);
    expect(w.activities).toHaveLength(1);
    expect(w.activities[0]!.identityJournalId).toBe(w.records[1]!.journalId);
  });
  it('the decoded checkpoint of a run round-trips (the run row is an ordinary activity row in checkpoint v1)', () => {
    const w = world([workflowLaunch(1, 'wf_run1')]);
    expect(decodeDelegationCheckpoint(encodeDelegationCheckpoint(w.cp))).toEqual(w.cp);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// R57 (D-4653): an evicted event can make a verdict LESS decided, never more (spec §5.3: a lost event can delay or prevent a link,
// never create one). The caller says how far its eviction reached (`evidenceHorizon`, the latest `observedAt` among events it no
// longer holds, or null); correlation, which knows which rung rests on what, answers `unmeasured('evidence-horizon')` in place of a
// link that the missing events could have vetoed.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

describe('evidence horizon (R57, D-4653): an eviction never decides a link', () => {
  const rec = rawRecord();
  const MARGIN = DELEGATION_EVIDENCE_MARGIN_MS;
  const at = (ms: number): string => formatDelegationInstant(Date.UTC(2026, 9, 14) + ms);
  const bashWorld = () => world([bashPre(10, 'toolu_b1', ['main-wt']), bashPost(12, 'toolu_b1', ['main-wt', RAW])]);
  const decide = (windows: readonly DelegationListingWindow[], horizon: string | null, w = bashWorld()) =>
    correlateDelegation(input({ record: rec, activities: w.activities, acceptedEvidence: w.acceptedEvidence, listingWindows: windows, evidenceHorizon: horizon }));
  const winAt = (startMs: number, endMs: number | null, over: Partial<DelegationListingWindow> = {}): DelegationListingWindow =>
    win({ startedAt: at(startMs), endedAt: endMs === null ? null : at(endMs), after: endMs === null ? null : ['main-wt', RAW], ...over });

  it('P1: two overlapping windows, one pre-listing evicted (the horizon between the two pre-listings): unmeasured, never linked. The same pair with no horizon stays unresolved', () => {
    const mine = win({ after: ['main-wt', RAW] });                                                    // [T10, T12]
    const other = win({ sessionId: OTHER, toolUseId: 'toolu_o1', startedAt: T(11), endedAt: T(13), before: ['main-wt'], after: ['main-wt'] });
    const whole = decide([mine, other], null);
    expect(whole.kind).toBe('unresolved');
    expect(whole.kind === 'unresolved' && whole.reason).toBe('overlapping-listing-window');
    const evicted = decide([mine], T(11));                                                            // the other's window is gone with its pre-listing
    expect(evicted.kind).toBe('unmeasured');
    expect(evicted.kind === 'unmeasured' && evicted.reason).toBe('evidence-horizon');
    expect(decide([mine], null).kind, 'with no eviction the lone window links, as ever').toBe('linked');
  });

  it('a horizon never turns the verdicts that were NOT links into anything else: an overlap held in full stays unresolved, whatever the horizon', () => {
    const mine = win({ after: ['main-wt', RAW] });
    const other = win({ sessionId: OTHER, toolUseId: 'toolu_o1', startedAt: T(11), endedAt: T(13), before: ['main-wt'], after: ['main-wt'] });
    for (const horizon of [T(-1000), T(11), T(10_000)]) {
      const v = decide([mine, other], horizon);
      expect(v.kind, horizon).toBe('unresolved');
      expect(v.kind === 'unresolved' && v.reason).toBe('overlapping-listing-window');
    }
  });

  it('rung 4, the margin (N3): a candidate window that began AT OR BEFORE one evidence margin after the horizon is unmeasured; one instant later it links', () => {
    expect(MARGIN, 'twenty minutes: twice the default Bash ceiling').toBe(20 * 60 * 1000);
    const horizon = at(0);
    expect(decide([winAt(MARGIN - 1, MARGIN + 5_000)], horizon).kind).toBe('unmeasured');
    expect(decide([winAt(MARGIN, MARGIN + 5_000)], horizon).kind, 'EXACTLY one margin after: the boundary is closed, like the overlap test').toBe('unmeasured');
    expect(decide([winAt(MARGIN + 1, MARGIN + 5_000)], horizon).kind).toBe('linked');
    expect(decide([winAt(1, 5_000)], horizon).kind, 'a window that began after the horizon by less than a margin').toBe('unmeasured');
    expect(decide([winAt(-5_000, -1)], horizon).kind, 'a window wholly before the horizon').toBe('unmeasured');
    const v = decide([winAt(MARGIN, MARGIN + 5_000)], horizon);
    expect(v.kind === 'unmeasured' && v.reason).toBe('evidence-horizon');
  });

  it('rung 4, other windows on the same repository: one open-ended, or one begun at or before the horizon, makes the link unmeasured; on another repository they do not matter', () => {
    const horizon = at(0);
    const mine = winAt(2 * MARGIN, 2 * MARGIN + 5_000);
    const later = (over: Partial<DelegationListingWindow>) => win({ sessionId: OTHER, toolUseId: 'toolu_o1', before: [], after: [], ...over });
    expect(decide([mine], horizon).kind, 'the control: a lone window far past the horizon links').toBe('linked');
    expect(decide([mine, later({ startedAt: at(3 * MARGIN), endedAt: null, after: null })], horizon).kind, 'open-ended').toBe('unmeasured');
    expect(decide([mine, later({ startedAt: at(-60_000), endedAt: at(-30_000) })], horizon).kind, 'began before the horizon').toBe('unmeasured');
    expect(decide([mine, later({ startedAt: at(0), endedAt: at(1_000) })], horizon).kind, 'began AT the horizon').toBe('unmeasured');
    expect(decide([mine, later({ startedAt: at(0 - 1), endedAt: at(500) })], horizon).kind).toBe('unmeasured');
    expect(decide([mine, later({ startedAt: at(MARGIN), endedAt: at(MARGIN + 1_000) })], horizon).kind, 'closed, after the horizon, disjoint').toBe('linked');
    expect(decide([mine, later({ repository: 'project-b', startedAt: at(-60_000), endedAt: null, after: null })], horizon).kind, 'another repository').toBe('linked');
  });

  it('a horizon that is not a canonical instant fails safe: unmeasured, never a link and never a throw', () => {
    for (const horizon of ['yesterday', '2026-10-14T00:00:00Z', '']) {
      const v = decide([winAt(2 * MARGIN, 2 * MARGIN + 5_000)], horizon);
      expect(v.kind, horizon).toBe('unmeasured');
      expect(v.kind === 'unmeasured' && v.reason).toBe('evidence-horizon');
    }
  });

  it('rungs 2 and 3 do NOT read the horizon instant (R65): an instant cannot see an event the lane dropped, so with only a horizon set they link as ever', () => {
    const toolIn = (n: number): DelegationEventEnvelopeV1 =>
      ({ ...base(n, { cwd: WT(RAW) }), eventKind: 'PostToolUse', toolName: 'Bash', toolUseId: `toolu_${n}`, outcome: 'completed', agentId: AGENT });
    const { base: agentBase } = agentWorld();
    const r3 = world([subagentStart(1, AGENT), toolIn(2)]);
    const wf = world([workflowLaunch(1, 'wf_run1'), subagentStart(2, AGENT)]);
    wf.builder.openWorkflowWorkerFromMeta(PARENT, INC, 'wf_run1', 1);
    const wfBase = input({
      record: record({ adminRecord: 'wf_run1-1', canonicalPath: WT('wf_run1-1') }), activities: wf.builder.build(1).activities, acceptedEvidence: wf.acceptedEvidence,
      pointMetas: [meta({ sourceKind: 'workflow', upstreamId: 'wf_run1-1', worktreePath: WT('wf_run1-1'), evidenceJournalId: wf.records[0]!.journalId })],
    });
    for (const horizon of [T(0), T(1), T(2), T(10_000)]) {
      expect(correlateDelegation({ ...agentBase, evidenceHorizon: horizon }).kind, `rung 2 agent at ${horizon}`).toBe('linked');
      expect(correlateDelegation({ ...wfBase, evidenceHorizon: horizon }).kind, `rung 2 workflow at ${horizon}`).toBe('linked');
      expect(correlateDelegation(input({ record: rec, activities: r3.activities, acceptedEvidence: r3.acceptedEvidence, evidenceHorizon: horizon })).kind, `rung 3 at ${horizon}`).toBe('linked');
    }
  });

  it('a verdict that was not a link is unchanged by any horizon (the module only ever makes a link less decided)', () => {
    const cases: DelegationCorrelationInput[] = [
      input({ hasRegistryRow: true }), input({ birthPassesRemaining: 2 }), agentWorld({ pointMetas: [] }).base,
      input({ record: record({ state: 'unreadable' }) }), input({ record: record({ canonicalPath: null }) }),
    ];
    for (const c of cases) expect(correlateDelegation({ ...c, evidenceHorizon: T(1000) })).toEqual(correlateDelegation(c));
  });

  it('the horizon is only read: the input is not changed by it', () => {
    const { base } = agentWorld();
    const frozen = deepFreeze({ ...base, evidenceHorizon: T(1) });
    expect(() => correlateDelegation(frozen)).not.toThrow();
  });
});

// ── R65 (part of D-4653): a lane that dropped an event never lets a link stand on evidence it can no longer see ──────────────────────

describe('dropped evidence (R65): the vetoes of rungs 2 and 3 rest on events an eviction can remove, so the lane remembers what it dropped', () => {
  const rec = rawRecord();
  const C = WT(RAW);
  const ELSEWHERE = `/fixture/${REPO}`;
  const toolAt = (n: number, agentId: string | undefined, cwd: string, over: Over = {}): DelegationEventEnvelopeV1 =>
    ({ ...base(n, { ...over, cwd }), eventKind: 'PostToolUse', toolName: 'Bash', toolUseId: `toolu_${n}`, outcome: 'completed', ...(agentId === undefined ? {} : { agentId }) });

  /** The fold of ALL the events (the checkpoint is durable: it keeps every activity), the evidence the lane still HOLDS, and what the lane
   *  REMEMBERS of the rest. `dropped` are indexes into `events`. */
  function evicting(events: readonly DelegationEventEnvelopeV1[], dropped: readonly number[]) {
    const w = world(events);
    const gone = new Set(dropped);
    return {
      w,
      held: w.acceptedEvidence.filter((_, i) => !gone.has(i)),
      index: indexDelegationDropped(dropped.map((i) => delegationDroppedKeyOf(events[i]!))),
    };
  }
  type Evicting = ReturnType<typeof evicting>;
  /** What a lane that FORGOT its drops would hand over: measured, and empty. */
  const NOTHING = indexDelegationDropped([]);
  const decide = (e: Evicting, record: DelegationCensusRecord, remembered: boolean, extra: Partial<DelegationCorrelationInput> = {}): DelegationCorrelationVerdict =>
    correlateDelegation(input({ record, activities: e.w.activities, acceptedEvidence: e.held, droppedEvidence: remembered ? e.index : NOTHING, ...extra }));
  const horizonOf = (v: DelegationCorrelationVerdict): string | false => v.kind === 'unmeasured' && v.reason;

  describe('the minimal keys of a dropped event', () => {
    it('keeps the parent, the agent ids it names, its working directory, and whether it is a SubagentStart or SubagentStop, and nothing else', () => {
      const keys = (e: DelegationEventEnvelopeV1) => delegationDroppedKeyOf(e);
      expect(keys(subagentStart(1, AGENT, { cwd: C }))).toEqual({ parentId: PARENT, parentIncarnation: INC, agentId: AGENT, launchAgentId: null, runId: null, cwd: C, startStop: true });
      expect(keys(subagentStop(1, AGENT))).toEqual({ parentId: PARENT, parentIncarnation: INC, agentId: AGENT, launchAgentId: null, runId: null, cwd: null, startStop: true });
      expect(keys(agentLaunch(1, AGENT, 'async-launched', { sessionId: OTHER }))).toEqual({ parentId: OTHER, parentIncarnation: INC, agentId: null, launchAgentId: AGENT, runId: null, cwd: null, startStop: false });
      expect(keys(workflowLaunch(1, 'wf_run1'))).toEqual({ parentId: PARENT, parentIncarnation: INC, agentId: null, launchAgentId: null, runId: 'wf_run1', cwd: null, startStop: false });
      expect(keys(toolAt(1, AGENT, C))).toEqual({ parentId: PARENT, parentIncarnation: INC, agentId: AGENT, launchAgentId: null, runId: null, cwd: C, startStop: false });
      expect(keys(toolAt(1, undefined, C))).toEqual({ parentId: PARENT, parentIncarnation: INC, agentId: null, launchAgentId: null, runId: null, cwd: C, startStop: false });
      expect(keys(sessionStart(1, { cwd: C, parentIncarnation: 'g2' }))).toEqual({ parentId: PARENT, parentIncarnation: 'g2', agentId: null, launchAgentId: null, runId: null, cwd: C, startStop: false });
      expect(Object.keys(keys(toolAt(1, AGENT, C))).sort()).toEqual(['agentId', 'cwd', 'launchAgentId', 'parentId', 'parentIncarnation', 'runId', 'startStop']);
    });
    it('indexes nothing as a MEASURED, empty index (not the unmeasured state), and the same keys twice as the same index', () => {
      expect(indexDelegationDropped([])).toMatchObject({ measured: true });
      expect(indexDelegationDropped([])).not.toEqual(DELEGATION_DROPPED_UNMEASURED);
      expect(DELEGATION_DROPPED_UNMEASURED).toEqual({ measured: false });
      const once = indexDelegationDropped([delegationDroppedKeyOf(toolAt(1, AGENT, C))]);
      const twice = indexDelegationDropped([delegationDroppedKeyOf(toolAt(1, AGENT, C)), delegationDroppedKeyOf(toolAt(2, AGENT, C))]);
      expect(twice).toEqual(once);
    });
  });

  describe('PA: the parent\'s own working directory (rung 3\'s parent-cwd veto)', () => {
    // The parent sits in the raw tree (event 0), moves elsewhere (1), launches a subagent from elsewhere (2) and the subagent works inside
    // the tree (3). Held in full the parent's cwd refuses the placement. Drop event 0 and nothing refuses it.
    const events = [toolAt(1, undefined, C), toolAt(15, undefined, ELSEWHERE), subagentStart(20, AGENT, { cwd: ELSEWHERE }), toolAt(22, AGENT, C)];
    it('with every event held: unresolved(parent-cwd)', () => {
      const v = decide(evicting(events, []), rec, true);
      expect(v.kind === 'unresolved' && v.reason).toBe('parent-cwd');
    });
    it('with the parent\'s event dropped and NOT remembered the placement would link: the failure the index exists to close', () => {
      expect(decide(evicting(events, [0]), rec, false).kind).toBe('linked');
    });
    it('with the parent\'s event dropped and remembered: unmeasured(evidence-horizon), never linked', () => {
      const v = decide(evicting(events, [0]), rec, true);
      expect(v.kind).toBe('unmeasured');
      expect(horizonOf(v)).toBe('evidence-horizon');
    });
    it('the veto is the parent\'s: the same dropped event from ANOTHER session or incarnation does not make the link unmeasured', () => {
      for (const over of [{ sessionId: OTHER }, { parentIncarnation: 'g2' }]) {
        const e = [toolAt(1, undefined, C, over), toolAt(15, undefined, ELSEWHERE), subagentStart(20, AGENT, { cwd: ELSEWHERE }), toolAt(22, AGENT, C)];
        expect(decide(evicting(e, [0]), rec, true).kind, JSON.stringify(over)).toBe('linked');
      }
    });
  });

  describe('PE: a second subagent on the path (rung 3\'s ambiguous-subagent-path and path-claimed-by-multiple-parents vetoes)', () => {
    const sameParent = [subagentStart(1, AGENT_2), toolAt(2, AGENT_2, C), toolAt(3, AGENT_2, C), subagentStart(20, AGENT, { cwd: ELSEWHERE }), toolAt(21, AGENT, C)];
    const otherParent = [subagentStart(1, AGENT_2, { sessionId: OTHER }), toolAt(2, AGENT_2, C, { sessionId: OTHER }), subagentStart(20, AGENT, { cwd: ELSEWHERE }), toolAt(21, AGENT, C)];
    it('the same parent\'s other subagent: unresolved in full, unmeasured when its events were dropped and remembered, linked when forgotten', () => {
      const full = decide(evicting(sameParent, []), rec, true);
      expect(full.kind === 'unresolved' && full.reason).toBe('ambiguous-subagent-path');
      expect(decide(evicting(sameParent, [1, 2]), rec, false).kind, 'forgotten').toBe('linked');
      const v = decide(evicting(sameParent, [1, 2]), rec, true);
      expect(v.kind).toBe('unmeasured');
      expect(horizonOf(v)).toBe('evidence-horizon');
    });
    it('ANOTHER parent\'s subagent: conflicting in full, unmeasured when its events were dropped and remembered, linked when forgotten', () => {
      const full = decide(evicting(otherParent, []), rec, true);
      expect(full.kind === 'conflicting' && full.reason).toBe('path-claimed-by-multiple-parents');
      expect(decide(evicting(otherParent, [1]), rec, false).kind, 'forgotten').toBe('linked');
      const v = decide(evicting(otherParent, [1]), rec, true);
      expect(v.kind).toBe('unmeasured');
      expect(horizonOf(v)).toBe('evidence-horizon');
    });
    it('a SubagentStart or SubagentStop of another agent at the path is not "emitted from inside" it: dropping one decides nothing', () => {
      for (const make of [subagentStart, subagentStop]) {
        const e = [make(1, AGENT_2, { cwd: C }), subagentStart(20, AGENT, { cwd: ELSEWHERE }), toolAt(21, AGENT, C)];
        expect(decide(evicting(e, [0]), rec, true).kind, make.name).toBe('linked');
      }
    });
  });

  describe('what does NOT make a link unmeasured', () => {
    const own = [subagentStart(1, AGENT, { cwd: ELSEWHERE }), toolAt(2, AGENT, C)];
    const go = (extra: DelegationEventEnvelopeV1): Evicting => evicting([...own, extra], [own.length]);
    it('a dropped event at another path, from the subagent itself, or from the same parent naming the same agent', () => {
      expect(decide(go(toolAt(30, undefined, ELSEWHERE)), rec, true).kind, 'the parent elsewhere').toBe('linked');
      expect(decide(go(toolAt(30, AGENT_2, ELSEWHERE)), rec, true).kind, 'another agent elsewhere').toBe('linked');
      expect(decide(go(toolAt(30, AGENT, C)), rec, true).kind, 'the subagent\'s own event at the path').toBe('linked');
      expect(decide(go(agentLaunch(30, AGENT)), rec, true).kind, 'the same parent\'s own launch of it').toBe('linked');
    });
    it('a dropped parent-cwd event of ANOTHER session, or at a path nobody asked about', () => {
      expect(decide(go(toolAt(30, undefined, C, { sessionId: OTHER })), rec, true).kind).toBe('linked');
      expect(decide(go(toolAt(30, undefined, `${C}/sub`)), rec, true).kind).toBe('linked');
    });
  });

  describe('clause (a): a rival claim from another parent', () => {
    // A rival whose claim opened a durable activity row is seen through the checkpoint whatever is evicted (PB). The case an eviction can
    // hide is a rival with NO row: a parent that only ever emitted a bare event naming the agent, whose meta the lane never read.
    it('PB: a rival claim that opened a durable activity row stays conflicting after its event is dropped, with or without the index', () => {
      const events = [subagentStart(1, AGENT, { sessionId: OTHER }), agentLaunch(10, AGENT), subagentStart(11, AGENT), subagentStop(12, AGENT)];
      const mine = (e: Evicting, remembered: boolean) => decide(e, record(), remembered, { pointMetas: [meta({ evidenceJournalId: e.w.records[1]!.journalId })] });
      const full = mine(evicting(events, []), true);
      expect(full.kind === 'conflicting' && full.reason).toBe('same-upstream-id-in-multiple-sessions');
      for (const remembered of [true, false]) {
        const v = mine(evicting(events, [0]), remembered);
        expect(v.kind === 'conflicting' && v.reason, `remembered=${remembered}`).toBe('same-upstream-id-in-multiple-sessions');
      }
    });
    it('the narrow case, rung 2 (agent): a rival with only a bare event (no activity row, no meta) that was dropped makes the link unmeasured', () => {
      const bare = bareTool(1, AGENT, { sessionId: OTHER, cwd: ELSEWHERE });
      const events = [bare, agentLaunch(10, AGENT), subagentStart(11, AGENT), subagentStop(12, AGENT)];
      const mine = (e: Evicting, remembered: boolean) => decide(e, record(), remembered, { pointMetas: [meta({ evidenceJournalId: e.w.records[1]!.journalId })] });
      expect(world(events).activities.filter((a) => a.parentId === OTHER), 'a bare event is not a join: it opens no activity').toEqual([]);
      expect(mine(evicting(events, [0]), false).kind, 'forgotten').toBe('linked');
      const v = mine(evicting(events, [0]), true);
      expect(v.kind).toBe('unmeasured');
      expect(horizonOf(v)).toBe('evidence-horizon');
      const withMeta = decide(evicting(events, [0]), record(), true, { pointMetas: [meta({ evidenceJournalId: 'j1' }), meta({ parentId: OTHER, evidenceJournalId: 'j2' })] });
      expect(withMeta.kind === 'conflicting' && withMeta.reason, 'the rival\'s meta WAS read before the event left: conflicting, as ever').toBe('same-upstream-id-in-multiple-sessions');
    });
    it('rung 3: the same bare rival, dropped, makes the subagent\'s link unmeasured', () => {
      const events = [bareTool(1, AGENT, { sessionId: OTHER, cwd: ELSEWHERE }), subagentStart(2, AGENT, { cwd: ELSEWHERE }), toolAt(3, AGENT, C)];
      expect(decide(evicting(events, [0]), rec, false).kind, 'forgotten').toBe('linked');
      expect(horizonOf(decide(evicting(events, [0]), rec, true))).toBe('evidence-horizon');
    });
    it('rung 2 (workflow): a dropped Workflow launch of the SAME run id from another parent makes the worker\'s link unmeasured', () => {
      const events = [workflowLaunch(1, 'wf_run1', 'async-launched', { sessionId: OTHER }), workflowLaunch(2, 'wf_run1'), subagentStart(3, AGENT)];
      const e = evicting(events, [0]);
      e.w.builder.openWorkflowWorkerFromMeta(PARENT, INC, 'wf_run1', 1);
      const activities = e.w.builder.build(1).activities;
      const m = meta({ sourceKind: 'workflow', upstreamId: 'wf_run1-1', worktreePath: WT('wf_run1-1'), evidenceJournalId: e.w.records[1]!.journalId });
      const ask = (remembered: boolean) => correlateDelegation(input({
        record: record({ adminRecord: 'wf_run1-1', canonicalPath: WT('wf_run1-1') }), activities, acceptedEvidence: e.held, pointMetas: [m], droppedEvidence: remembered ? e.index : NOTHING,
      }));
      expect(ask(false).kind, 'forgotten').toBe('linked');
      expect(horizonOf(ask(true))).toBe('evidence-horizon');
    });
    it('the same parent\'s own dropped events naming the agent never make its own link unmeasured', () => {
      const events = [agentLaunch(1, AGENT), subagentStart(2, AGENT), subagentStop(3, AGENT)];
      const e = evicting(events, [0]);
      expect(correlateDelegation(input({ activities: e.w.activities, acceptedEvidence: e.held, pointMetas: [meta({ evidenceJournalId: 'j1' })], droppedEvidence: e.index })).kind).toBe('linked');
    });
  });

  describe('N1: combine never lets a link beat an evidence-horizon answer', () => {
    // Session OTHER's Bash call created the raw tree (rung 4 would link OTHER's activity); this parent's isolated subagent works inside it
    // (rung 3 would link the subagent's). Held in full: the two rungs name different parents, so the tree is conflicting.
    const events = [
      bashPre(10, 'toolu_b1', ['main-wt'], { sessionId: OTHER }), bashPost(12, 'toolu_b1', ['main-wt', RAW], { sessionId: OTHER }),
      subagentStart(1, AGENT, { cwd: ELSEWHERE }), toolAt(20, AGENT, C),
    ];
    const windows = [win({ sessionId: OTHER, startedAt: T(10), endedAt: T(12), before: ['main-wt'], after: ['main-wt', RAW] })];
    const ask = (over: Partial<DelegationCorrelationInput>) => { const e = evicting(events, []); return decide(e, rec, true, { listingWindows: windows, ...over }); };
    it('with nothing dropped the two parents conflict', () => {
      const v = ask({});
      expect(v.kind === 'conflicting' && v.reason).toBe('rungs-disagree');
    });
    it('rung 4 answering evidence-horizon (the candidate began within the margin of the horizon) beside rung 3\'s link is unmeasured, never the link', () => {
      const v = ask({ evidenceHorizon: T(0) });
      expect(v.kind).toBe('unmeasured');
      expect(horizonOf(v)).toBe('evidence-horizon');
    });
    it('the mirror: rung 3 answering evidence-horizon beside rung 4\'s link is unmeasured, never the link', () => {
      const pa = [toolAt(1, undefined, C), toolAt(15, undefined, ELSEWHERE), subagentStart(20, AGENT, { cwd: ELSEWHERE }), toolAt(22, AGENT, C),
        bashPre(30, 'toolu_b1', ['main-wt'], { sessionId: OTHER }), bashPost(32, 'toolu_b1', ['main-wt', RAW], { sessionId: OTHER })];
      const e = evicting(pa, [0]);
      const w = [win({ sessionId: OTHER, startedAt: T(30), endedAt: T(32), before: ['main-wt'], after: ['main-wt', RAW] })];
      const full = decide(evicting(pa, []), rec, true, { listingWindows: w });
      expect(full.kind === 'linked' && full.rung, 'held in full: the parent\'s cwd refuses rung 3 and the creator\'s window links alone').toBe(4);
      const v = decide(e, rec, true, { listingWindows: w });
      expect(v.kind).toBe('unmeasured');
      expect(horizonOf(v)).toBe('evidence-horizon');
    });
    it('the same parent on both rungs agrees, and still does not beat a horizon answer', () => {
      const same = [bashPre(10, 'toolu_b1', ['main-wt']), bashPost(12, 'toolu_b1', ['main-wt', RAW]), subagentStart(1, AGENT, { cwd: ELSEWHERE }), toolAt(20, AGENT, C)];
      const e = evicting(same, []);
      const w = [win({ startedAt: T(10), endedAt: T(12), before: ['main-wt'], after: ['main-wt', RAW] })];
      expect(decide(e, rec, true, { listingWindows: w }).kind, 'no horizon: the two agree').toBe('linked');
      const v = decide(e, rec, true, { listingWindows: w, evidenceHorizon: T(0) });
      expect(v.kind).toBe('unmeasured');
      expect(horizonOf(v)).toBe('evidence-horizon');
    });
    it('a link beside a merely unresolved or unmeasured answer that is NOT a horizon answer is still the link', () => {
      const e = evicting([subagentStart(1, AGENT, { cwd: ELSEWHERE }), toolAt(2, AGENT, C)], []);
      const v = decide(e, rec, true, { listingWindows: [win({ after: ['main-wt', RAW] }), win({ sessionId: OTHER, toolUseId: 'toolu_o1', startedAt: T(11), endedAt: T(13), before: ['main-wt'], after: ['main-wt'] })] });
      expect(v.kind, 'rung 4 is unresolved (an overlap), rung 3 links').toBe('linked');
    });
    it('the evidence of the unmeasured answer names every witness', () => {
      const v = ask({ evidenceHorizon: T(0) });
      expect(v.evidenceJournalIds.length).toBeGreaterThan(0);
    });
  });

  describe('an index that was never measured is not an empty one (D-4008: unknown is never empty)', () => {
    // A lane that restarted has lost its in-memory index. Until it has streamed the whole retained journal again, it cannot say what it
    // dropped, so no link may stand: the UNMEASURED state answers `evidence-horizon` for a link on every rung, and a measured-empty
    // index (nothing was dropped) answers exactly as before.
    const agent = agentWorld();
    const r3 = world([subagentStart(1, AGENT, { cwd: ELSEWHERE }), toolAt(2, AGENT, C)]);
    const wf = world([workflowLaunch(1, 'wf_run1'), subagentStart(2, AGENT)]);
    wf.builder.openWorkflowWorkerFromMeta(PARENT, INC, 'wf_run1', 1);
    const wfInput = input({
      record: record({ adminRecord: 'wf_run1-1', canonicalPath: WT('wf_run1-1') }), activities: wf.builder.build(1).activities, acceptedEvidence: wf.acceptedEvidence,
      pointMetas: [meta({ sourceKind: 'workflow', upstreamId: 'wf_run1-1', worktreePath: WT('wf_run1-1'), evidenceJournalId: wf.records[0]!.journalId })],
    });
    const r4 = world([bashPre(10, 'toolu_b1', ['main-wt']), bashPost(12, 'toolu_b1', ['main-wt', RAW])]);
    const worlds: readonly (readonly [string, DelegationCorrelationInput])[] = [
      ['rung 2 (agent)', agent.base],
      ['rung 2 (workflow)', wfInput],
      ['rung 3', input({ record: rec, activities: r3.activities, acceptedEvidence: r3.acceptedEvidence })],
      ['rung 4', input({ record: rec, activities: r4.activities, acceptedEvidence: r4.acceptedEvidence, listingWindows: [win({ after: ['main-wt', RAW] })] })],
    ];
    it('every link answers unmeasured(evidence-horizon) while the index is unmeasured, and links once it is measured and empty', () => {
      for (const [name, w] of worlds) {
        expect(correlateDelegation({ ...w, droppedEvidence: NOTHING }).kind, `${name}, measured and empty`).toBe('linked');
        const v = correlateDelegation({ ...w, droppedEvidence: DELEGATION_DROPPED_UNMEASURED });
        expect(v.kind, `${name}, unmeasured`).toBe('unmeasured');
        expect(horizonOf(v), name).toBe('evidence-horizon');
      }
    });
    it('a verdict that was not a link is unchanged by the unmeasured state', () => {
      const cases: DelegationCorrelationInput[] = [
        input({ hasRegistryRow: true }), input({ birthPassesRemaining: 2 }), agentWorld({ pointMetas: [] }).base,
        input({ record: record({ state: 'unreadable' }) }), input({ record: record({ canonicalPath: null }) }),
      ];
      for (const c of cases) expect(correlateDelegation({ ...c, droppedEvidence: DELEGATION_DROPPED_UNMEASURED })).toEqual(correlateDelegation(c));
    });
  });

  describe('forgetting a key (prunableDelegationDropped): only what no present tree and no activity row can still ask about', () => {
    const key = (over: Partial<DelegationDroppedKey>): DelegationDroppedKey =>
      ({ parentId: PARENT, parentIncarnation: INC, agentId: null, launchAgentId: null, runId: null, cwd: null, startStop: false, ...over });
    const entries = (ks: readonly DelegationDroppedKey[], at = 0) => ks.map((k) => [delegationDroppedKeyId(k), k, at] as const);
    const pathsOf = (census: readonly DelegationCensusRecord[]): ReadonlySet<string> => new Set(census.flatMap((r) => (r.canonicalPath === null ? [] : [r.canonicalPath])));
    const forgotten = (ks: readonly DelegationDroppedKey[], census: readonly DelegationCensusRecord[], activities: readonly DelegationActivityRow[] = []): DelegationDroppedKey[] => {
      const ids = new Set(prunableDelegationDropped(entries(ks), census, pathsOf(census), activities, Number.POSITIVE_INFINITY));
      return ks.filter((k) => ids.has(delegationDroppedKeyId(k)));
    };
    const rival = (agentId: string) => key({ parentId: OTHER, agentId });
    const agentRow = (parentId: string, agentId: string): DelegationActivityRow =>
      world([subagentStart(1, agentId, { sessionId: parentId })]).activities.find((a) => a.sourceKind === 'agent')!;
    const workflowRow = (parentId: string): DelegationActivityRow => {
      const w = world([workflowLaunch(1, 'wf_run1', 'async-launched', { sessionId: parentId })]);
      w.builder.openWorkflowWorkerFromMeta(parentId, INC, 'wf_run1', 1);
      return w.builder.build(1).activities.find((a) => a.sourceKind === 'workflow' && a.upstreamId === 'wf_run1-1')!;
    };

    it('a path: kept while a present record has it, forgotten otherwise; a key with no cwd and no name is forgotten', () => {
      const at = key({ cwd: C, agentId: AGENT_2 });
      expect(forgotten([at], [rec])).toEqual([]);
      expect(forgotten([at], [rawRecord({ adminRecord: 'other', canonicalPath: WT('other') })])).toEqual([at]);
      expect(forgotten([at], [record({ canonicalPath: null })])).toEqual([at]);
      expect(forgotten([key({})], [rec])).toEqual([key({})]);
    });
    it('an agent id a present agent-named tree asks about: kept for a rival with no activity row, forgotten once the rival has one', () => {
      const census = [record()];                                                    // agent-AGENT
      expect(forgotten([rival(AGENT)], census)).toEqual([]);
      expect(forgotten([rival(AGENT)], census, [agentRow(OTHER, AGENT)])).toEqual([rival(AGENT)]);
      expect(forgotten([rival(AGENT_2)], census), 'nobody asks about it').toEqual([rival(AGENT_2)]);
      expect(forgotten([key({ parentId: OTHER, launchAgentId: AGENT })], census), 'a launch response names it too').toEqual([]);
    });
    it('an agent id rung 3 asks about (an agent activity row exists for another parent): kept for a rival with no row', () => {
      const mine = agentRow(PARENT, AGENT);
      expect(forgotten([rival(AGENT)], [rec], [mine])).toEqual([]);
      expect(forgotten([key({ agentId: AGENT })], [rec], [mine]), 'the parent\'s own key is redundant by its own row').toEqual([key({ agentId: AGENT })]);
    });
    it('a run id: kept while a present workflow tree or a workflow row carries the run, forgotten otherwise', () => {
      const k = key({ parentId: OTHER, runId: 'wf_run1' });
      expect(forgotten([k], [record({ adminRecord: 'wf_run1-1', canonicalPath: WT('wf_run1-1') })])).toEqual([]);
      expect(forgotten([k], [rec], [workflowRow(PARENT)])).toEqual([]);
      expect(forgotten([k], [rec])).toEqual([k]);
      const other = key({ parentId: OTHER, runId: 'wf_other' });
      expect(forgotten([other], [record({ adminRecord: 'wf_run1-1', canonicalPath: WT('wf_run1-1') })])).toEqual([other]);
    });
    it('SOUND: against every world above, the verdict from the index with every key equals the verdict from the index without the forgotten ones', () => {
      const scenarios: readonly { events: readonly DelegationEventEnvelopeV1[]; dropped: readonly number[]; record: DelegationCensusRecord }[] = [
        { events: [toolAt(1, undefined, C), toolAt(15, undefined, ELSEWHERE), subagentStart(20, AGENT, { cwd: ELSEWHERE }), toolAt(22, AGENT, C)], dropped: [0], record: rec },
        { events: [subagentStart(1, AGENT_2), toolAt(2, AGENT_2, C), subagentStart(20, AGENT, { cwd: ELSEWHERE }), toolAt(21, AGENT, C)], dropped: [1], record: rec },
        { events: [subagentStart(1, AGENT_2, { sessionId: OTHER }), toolAt(2, AGENT_2, C, { sessionId: OTHER }), subagentStart(20, AGENT, { cwd: ELSEWHERE }), toolAt(21, AGENT, C)], dropped: [1], record: rec },
        { events: [bareTool(1, AGENT, { sessionId: OTHER, cwd: ELSEWHERE }), agentLaunch(10, AGENT), subagentStart(11, AGENT), subagentStop(12, AGENT)], dropped: [0], record: record() },
        { events: [bareTool(1, AGENT, { sessionId: OTHER, cwd: ELSEWHERE }), subagentStart(2, AGENT, { cwd: ELSEWHERE }), toolAt(3, AGENT, C)], dropped: [0], record: rec },
        { events: [toolAt(1, AGENT_2, ELSEWHERE), toolAt(2, undefined, ELSEWHERE), subagentStart(3, AGENT, { cwd: ELSEWHERE }), toolAt(4, AGENT, C)], dropped: [0, 1], record: rec },
      ];
      for (const [i, sc] of scenarios.entries()) {
        const e = evicting(sc.events, sc.dropped);
        const keys = sc.dropped.map((d) => delegationDroppedKeyOf(sc.events[d]!));
        const gone = new Set(prunableDelegationDropped(entries(keys), [sc.record], pathsOf([sc.record]), e.w.activities, Number.POSITIVE_INFINITY));
        const kept = keys.filter((k) => !gone.has(delegationDroppedKeyId(k)));
        const ask = (ks: readonly DelegationDroppedKey[]) => correlateDelegation(input({ record: sc.record, activities: e.w.activities, acceptedEvidence: e.held, droppedEvidence: indexDelegationDropped(ks) }));
        expect(ask(kept), `scenario ${i}`).toEqual(ask(keys));
      }
    });
  });

  describe('the prune plan (R69, R70, R71): a key is forgotten only for a tree a measured census of its project shows gone', () => {
    const key = (over: Partial<DelegationDroppedKey>): DelegationDroppedKey =>
      ({ parentId: PARENT, parentIncarnation: INC, agentId: null, launchAgentId: null, runId: null, cwd: null, startStop: false, ...over });
    const AT = Date.UTC(2026, 9, 14) + 10_000_000;                                  // the census's measuredAt
    const proj = (over: Partial<DelegationPruneProject> = {}): DelegationPruneProject => ({ records: [], standing: false, measuredSinceStart: true, unplacedHold: false, ...over });
    const at = (k: DelegationDroppedKey) => k;
    const planOf = (
      ks: readonly DelegationDroppedKey[], projects: Record<string, DelegationPruneProject>, known: Record<string, string> = {},
      over: Partial<Parameters<typeof planDelegationDroppedPrune>[0]> = {},
    ) => planDelegationDroppedPrune({
      keys: ks.map((k) => [delegationDroppedKeyId(k), k, AT - 10 * DELEGATION_CLOCK_SKEW_MS] as const), projects: new Map(Object.entries(projects)),
      known: new Map(Object.entries(known)), gonePaths: new Set(), projectOfParent: () => undefined, activities: [], measuredAtMs: AT,
      lost: new Set(), holdCap: 1000, projectsRoot: null, ...over,
    });
    /** The keys the plan forgets (R73: a plan always answers; there is no fleet-wide skip any more). */
    const plan = (
      ks: readonly DelegationDroppedKey[], projects: Record<string, DelegationPruneProject>, known: Record<string, string> = {},
      over: Partial<Parameters<typeof planDelegationDroppedPrune>[0]> = {},
    ): DelegationDroppedKey[] => {
      const gone = new Set(planOf(ks, projects, known, over).forget);
      return ks.filter((k) => gone.has(delegationDroppedKeyId(k)));
    };
    const TREE = delegationTreeKey(REPO, RAW);
    const kC = key({ cwd: C, agentId: AGENT_2 });
    const listed = (over: Partial<DelegationCensusRecord> = {}): DelegationCensusRecord => rawRecord(over);

    it('a measured census that lists no tree at the path forgets the key; a listed record\'s path protects it', () => {
      expect(plan([kC], { [REPO]: proj({ records: [] }) })).toEqual([kC]);
      expect(plan([kC], { [REPO]: proj({ records: [listed()] }) })).toEqual([]);
    });

    it('N8: a remembered path is protected until a measured census of ITS project shows the tree gone: a null path, a null view and an absent project each keep it', () => {
      const known = { [TREE]: C };
      expect(plan([kC], { [REPO]: proj({ records: [] }) }, known), 'listed nowhere in a measured census: gone').toEqual([kC]);
      expect(plan([kC], { [REPO]: proj({ records: [listed({ state: 'absent', canonicalPath: null })] }) }, known), 'listed absent: gone').toEqual([kC]);
      expect(plan([kC], { [REPO]: proj({ records: [listed({ state: 'unreadable', canonicalPath: null })] }) }, known), 'listed with a null path').toEqual([]);
      expect(plan([kC], { [REPO]: proj({ records: null }) }, known), 'the project\'s view is null this pass').toEqual([]);
      expect(plan([kC], { 'project-b': proj({ records: [] }) }, known), 'the project is absent from the census').toEqual([]);
    });

    it('R73 (N12): a null-path record never stops the prune by itself, whatever its state; the caller holds a project back only through unplacedHold', () => {
      for (const state of ['present', 'unreadable'] as const) {
        const nullPath = listed({ state, canonicalPath: null });
        expect(plan([kC], { [REPO]: proj({ records: [nullPath] }) }), state).toEqual([kC]);
        expect(plan([kC], { [REPO]: proj({ records: [nullPath] }) }, { [TREE]: C }), `${state}, remembered: protected`).toEqual([]);
      }
      const ofDemo = key({ parentId: PARENT, cwd: '/fixture/unknown', agentId: AGENT_2 });
      const ofOther = key({ parentId: OTHER, cwd: '/fixture/unknown-2', agentId: AGENT_2 });
      const projectOfParent = (id: string): string | undefined => (id === PARENT ? REPO : id === OTHER ? 'project-b' : undefined);
      const projects = { [REPO]: proj({ records: [listed({ adminRecord: 'flaky', canonicalPath: null, state: 'unreadable' })], unplacedHold: true }), 'project-b': proj() };
      expect(plan([ofDemo, ofOther], projects, {}, { projectOfParent }), 'the held project keeps ITS OWN keys; the other prunes').toEqual([ofOther]);
      expect(planOf([ofDemo, ofOther], projects, {}, { projectOfParent }).held).toEqual(new Map([[REPO, 1]]));
    });

    it('R73 rule 2: a key forgotten while no tree shown gone in this census had its path leaves a path mark; one at such a tree\'s path does not', () => {
      const far = key({ cwd: '/fixture/never-a-tree' });
      const atGone = key({ cwd: '/fixture/gone-tree' });
      const p = planOf([far, atGone], { [REPO]: proj() }, {}, { gonePaths: new Set(['/fixture/gone-tree']) });
      expect(p.forget.sort()).toEqual([delegationDroppedKeyId(far), delegationDroppedKeyId(atGone)].sort());
      expect(p.markPaths).toEqual([{ path: '/fixture/never-a-tree', project: null, prefix: null }]);
      const known = { [delegationTreeKey(REPO, 'gone-tree')]: '/fixture/gone-tree' };
      expect(planOf([atGone], { [REPO]: proj() }, known).markPaths, 'a remembered tree its own measured census shows gone, in this pass').toEqual([]);
      expect(planOf([key({})], { [REPO]: proj() }).markPaths, 'no cwd, no path mark').toEqual([]);
    });

    it('R75: a path mark is attributed to the project whose checkout root or known tree holds it, and to no project otherwise', () => {
      const ROOT = '/fixture/projects';
      const known = { [delegationTreeKey('project-b', 'ws')]: '/fixture/elsewhere/ws' };
      const ks = [
        key({ cwd: `${ROOT}/project-a/sub/dir` }), key({ cwd: `${ROOT}/project-a` }), key({ cwd: '/fixture/elsewhere/ws/sub' }),
        key({ cwd: '/fixture/elsewhere/other' }), key({ cwd: `${ROOT}-sibling/x` }),
      ];
      const p = planOf(ks, { [REPO]: proj(), 'project-b': proj({ records: null }) }, known, { projectsRoot: ROOT });
      expect(new Map(p.markPaths.map((m) => [m.path, m.project]))).toEqual(new Map<string, string | null>([
        [`${ROOT}/project-a/sub/dir`, 'project-a'], [`${ROOT}/project-a`, 'project-a'], ['/fixture/elsewhere/ws/sub', 'project-b'],
        ['/fixture/elsewhere/other', null], [`${ROOT}-sibling/x`, null],
      ]));
      expect(planOf([key({ cwd: `${ROOT}/project-a/x` })], { [REPO]: proj() }, {}, { projectsRoot: null }).markPaths, 'no root configured').toEqual([{ path: `${ROOT}/project-a/x`, project: null, prefix: null }]);
      // R77: each attributed mark carries the directory that attributed it (the nearest tree, or the project's checkout under the root)
      expect(new Map(p.markPaths.map((m) => [m.path, m.prefix]))).toEqual(new Map<string, string | null>([
        [`${ROOT}/project-a/sub/dir`, `${ROOT}/project-a`], [`${ROOT}/project-a`, `${ROOT}/project-a`], ['/fixture/elsewhere/ws/sub', '/fixture/elsewhere/ws'],
        ['/fixture/elsewhere/other', null], [`${ROOT}-sibling/x`, null],
      ]));
      // N20 (coordinator 5439): a root the caller could not resolve attributes NOTHING by the root, never by its configured spelling; the
      // nearest-tree rule still applies, because a tree's path is canonical
      const unresolved = planOf(ks, { [REPO]: proj(), 'project-b': proj({ records: null }) }, known, { projectsRoot: DELEGATION_ROOT_UNMEASURED });
      expect(new Map(unresolved.markPaths.map((m) => [m.path, m.project]))).toEqual(new Map<string, string | null>([
        [`${ROOT}/project-a/sub/dir`, null], [`${ROOT}/project-a`, null], ['/fixture/elsewhere/ws/sub', 'project-b'],
        ['/fixture/elsewhere/other', null], [`${ROOT}-sibling/x`, null],
      ]));
    });

    it('R73 rule 2: a forgotten name nobody asks about yet leaves an id mark; a name made redundant by its own parent\'s row does not', () => {
      const mine = world([subagentStart(1, AGENT)]).activities.find((a) => a.sourceKind === 'agent')!;
      const p = planOf([key({ parentId: OTHER, agentId: AGENT_2 }), key({ agentId: AGENT }), key({ parentId: OTHER, runId: 'wf_unasked' }), key({ parentId: OTHER, launchAgentId: 'b0b0b0b0' })],
        { [REPO]: proj() }, {}, { activities: [mine] });
      expect(p.forget).toHaveLength(4);
      expect([...p.markIds].sort()).toEqual([AGENT_2, 'b0b0b0b0', 'wf_unasked'].sort());
    });

    it('R73 rule 3: a held project over the cap is lost: its keys go through the prune, and a key at its remembered path goes with no path mark (the project mark covers it)', () => {
      const down = proj({ records: null, measuredSinceStart: false });
      const projectOfParent = (id: string): string | undefined => (id === OTHER ? 'down' : undefined);
      const known = { [delegationTreeKey('down', 'tree')]: '/fixture/down/tree' };
      const atTree = key({ parentId: OTHER, cwd: '/fixture/down/tree', agentId: AGENT_2 });
      const elsewhere = key({ parentId: OTHER, cwd: '/fixture/down/elsewhere', agentId: AGENT_2 });
      const under = planOf([atTree, elsewhere], { [REPO]: proj(), down }, known, { projectOfParent, holdCap: 2 });
      expect(under.forget, 'at the cap: held').toEqual([]);
      expect(under.lose).toEqual([]);
      expect(under.held).toEqual(new Map([['down', 2]]));
      const over = planOf([atTree, elsewhere], { [REPO]: proj(), down }, known, { projectOfParent, holdCap: 1 });
      expect(over.lose).toEqual(['down']);
      expect(over.forget.sort()).toEqual([delegationDroppedKeyId(atTree), delegationDroppedKeyId(elsewhere)].sort());
      expect(over.markPaths, 'the tree\'s own path is covered by the lost project; the unknown one is marked').toEqual([{ path: '/fixture/down/elsewhere', project: null, prefix: null }]);
      expect(over.held).toEqual(new Map());
      const already = planOf([atTree], { [REPO]: proj(), down }, known, { projectOfParent, lost: new Set(['down']) });
      expect(already.forget, 'a lost project holds nothing back and protects none of its remembered paths').toEqual([delegationDroppedKeyId(atTree)]);
      expect(already.markPaths).toEqual([]);
      expect(already.lose).toEqual([]);
    });

    it('R70: a standing refusal counts as measured with no trees: it does not block, and what it remembered is gone', () => {
      const projects = { [REPO]: proj({ records: [listed()] }), bad: proj({ records: null, standing: true, measuredSinceStart: false }) };
      const far = key({ cwd: '/fixture/gone', agentId: AGENT_2 });
      expect(plan([far], projects)).toEqual([far]);
      expect(plan([kC], { ...projects, bad: proj({ records: null, standing: true, measuredSinceStart: false }) }, { [delegationTreeKey('bad', 'tree')]: '/fixture/bad/tree' })).toEqual([]);
      const ofBad = key({ parentId: OTHER, cwd: '/fixture/gone', agentId: AGENT_2 });
      expect(plan([ofBad], projects, {}, { projectOfParent: (id) => (id === OTHER ? 'bad' : undefined) }), 'a session of a standing project holds nothing back').toEqual([ofBad]);
      const underBad = key({ cwd: '/fixture/bad/tree', agentId: AGENT_2 });
      expect(plan([underBad], projects, { [delegationTreeKey('bad', 'tree')]: '/fixture/bad/tree' }), 'a path a standing project once had is gone').toEqual([underBad]);
    });

    it('per project: a project that was never measured since the restart keeps ITS OWN keys (its sessions\' and the paths it remembers); the others prune', () => {
      const projects = { [REPO]: proj({ records: [] }), down: proj({ records: null, measuredSinceStart: false }) };
      const mine = key({ parentId: PARENT, cwd: '/fixture/a/gone', agentId: AGENT_2 });
      const theirs = key({ parentId: OTHER, cwd: '/fixture/b/gone', agentId: AGENT_2 });
      const atTheirPath = key({ parentId: PARENT, cwd: '/fixture/down/tree', agentId: AGENT_2 });
      const nobody = key({ parentId: 'lane-z-demo', cwd: '/fixture/z/gone', agentId: AGENT_2 });
      const projectOfParent = (id: string): string | undefined => (id === PARENT ? REPO : id === OTHER ? 'down' : undefined);
      const known = { [delegationTreeKey('down', 'tree')]: '/fixture/down/tree' };
      const out = plan([mine, theirs, atTheirPath, nobody], projects, known, { projectOfParent });
      expect(out).toEqual(expect.arrayContaining([mine, nobody]));
      expect(out).toHaveLength(2);
      const measuredLater = plan([mine, theirs, nobody], { ...projects, down: proj({ records: null, measuredSinceStart: true }) }, {}, { projectOfParent });
      expect(measuredLater, 'once it has been measured since the restart its keys prune too').toHaveLength(3);
    });

    it('R69 item 5: a key whose latest dropped event is not before the census (less the clock skew allowance) is kept; one before it is forgotten', () => {
      const cutoff = AT - DELEGATION_CLOCK_SKEW_MS;
      const stamped = (stamp: number) => planDelegationDroppedPrune({
        keys: [[delegationDroppedKeyId(kC), kC, stamp]], projects: new Map([[REPO, proj({ records: [] })]]), known: new Map(), gonePaths: new Set(), projectOfParent: () => undefined, activities: [], measuredAtMs: AT,
        lost: new Set(), holdCap: 1000, projectsRoot: null,
      }).forget;
      expect(stamped(cutoff - 1)).toEqual([delegationDroppedKeyId(kC)]);
      expect(stamped(cutoff), 'exactly at the cutoff').toEqual([]);
      expect(stamped(AT + 1), 'dropped after the census was measured').toEqual([]);
      expect(stamped(Number.POSITIVE_INFINITY), 'an event time nobody could read').toEqual([]);
    });

    it('delegationGoneTrees: only a measured census of the tree\'s own project (or a standing one) shows it gone', () => {
      const known = new Map([[TREE, C], [delegationTreeKey('project-b', 'x'), '/fixture/b/x']]);
      const gone = (projects: Record<string, DelegationPruneProject>) => delegationGoneTrees(known, new Map(Object.entries(projects)));
      expect(gone({ [REPO]: proj({ records: [] }) })).toEqual([TREE]);
      expect(gone({ [REPO]: proj({ records: [listed()] }) })).toEqual([]);
      expect(gone({ [REPO]: proj({ records: null }) })).toEqual([]);
      expect(gone({ [REPO]: proj({ records: null, standing: true }) })).toEqual([TREE]);
      expect(gone({})).toEqual([]);
    });
  });

  describe('purity', () => {
    it('a verdict that was not a link is unchanged by any dropped evidence', () => {
      const big = indexDelegationDropped([
        delegationDroppedKeyOf(toolAt(1, undefined, C)), delegationDroppedKeyOf(toolAt(2, AGENT_2, C)), delegationDroppedKeyOf(bareTool(3, AGENT, { sessionId: OTHER })),
      ]);
      const cases: DelegationCorrelationInput[] = [
        input({ hasRegistryRow: true }), input({ birthPassesRemaining: 2 }), agentWorld({ pointMetas: [] }).base,
        input({ record: record({ state: 'unreadable' }) }), input({ record: record({ canonicalPath: null }) }),
      ];
      for (const c of cases) expect(correlateDelegation({ ...c, droppedEvidence: big })).toEqual(correlateDelegation(c));
    });
    it('the index is only read: a frozen input is not changed by it', () => {
      const e = evicting([toolAt(1, undefined, C), subagentStart(20, AGENT, { cwd: ELSEWHERE }), toolAt(22, AGENT, C)], [0]);
      const frozen = deepFreeze(input({ record: rec, activities: e.w.activities, acceptedEvidence: e.held, droppedEvidence: e.index }));
      expect(() => correlateDelegation(frozen)).not.toThrow();
      expect(horizonOf(correlateDelegation(frozen))).toBe('evidence-horizon');
    });
  });

  describe('R73: the lossy marks a forgetting lane leaves behind move every link a forgotten key could have vetoed to unmeasured', () => {
    const setOf = (...texts: string[]) => { const s = emptyDelegationHashSet(); for (const t of texts) delegationHashSetAdd(s, t, 1000); return s; };
    const marks = (over: Partial<DelegationLostMarks>): DelegationLostMarks => ({ ...DELEGATION_NO_MARKS, ...over });
    const withMarks = (m: DelegationLostMarks) => indexDelegationDropped([], m);
    const r3 = world([subagentStart(1, AGENT, { cwd: ELSEWHERE }), toolAt(2, AGENT, C)]);
    const rung3 = (m: DelegationLostMarks) => input({ record: rec, activities: r3.activities, acceptedEvidence: r3.acceptedEvidence, droppedEvidence: withMarks(m) });
    const agent = agentWorld();
    const rung2 = (m: DelegationLostMarks) => ({ ...agent.base, droppedEvidence: withMarks(m) });
    const wf = world([workflowLaunch(1, 'wf_run1'), subagentStart(2, AGENT)]);
    wf.builder.openWorkflowWorkerFromMeta(PARENT, INC, 'wf_run1', 1);
    const wfRung2 = (m: DelegationLostMarks) => input({
      record: record({ adminRecord: 'wf_run1-1', canonicalPath: WT('wf_run1-1') }), activities: wf.builder.build(1).activities, acceptedEvidence: wf.acceptedEvidence,
      pointMetas: [meta({ sourceKind: 'workflow', upstreamId: 'wf_run1-1', worktreePath: WT('wf_run1-1'), evidenceJournalId: wf.records[0]!.journalId })], droppedEvidence: withMarks(m),
    });
    const r4 = world([bashPre(10, 'toolu_b1', ['main-wt']), bashPost(12, 'toolu_b1', ['main-wt', RAW])]);
    const rung4 = (m: DelegationLostMarks) => input({ record: rec, activities: r4.activities, acceptedEvidence: r4.acceptedEvidence, listingWindows: [win({ after: ['main-wt', RAW] })], droppedEvidence: withMarks(m) });
    const horizon = (v: DelegationCorrelationVerdict) => v.kind === 'unmeasured' && v.reason === 'evidence-horizon';

    it('the hash set: a text added is found, one not added is not, and a full set refuses a new text (the caller raises the global flag)', () => {
      const s = emptyDelegationHashSet();
      expect(delegationHashSetHas(s, '/fixture/a')).toBe(false);
      for (let i = 0; i < 5000; i++) expect(delegationHashSetAdd(s, `/fixture/p-${i}`, 6000)).toBe(true);
      expect(s.size).toBe(5000);
      for (let i = 0; i < 5000; i++) expect(delegationHashSetHas(s, `/fixture/p-${i}`)).toBe(true);
      expect(delegationHashSetHas(s, '/fixture/p-5000')).toBe(false);
      expect(delegationHashSetAdd(s, '/fixture/p-1', 6000), 'present already').toBe(true);
      expect(s.size).toBe(5000);
      const full = setOf();
      expect(delegationHashSetAdd(full, 'a', 2)).toBe(true);
      expect(delegationHashSetAdd(full, 'b', 2)).toBe(true);
      expect(delegationHashSetAdd(full, 'c', 2), 'at the cap').toBe(false);
      expect(delegationHashSetHas(full, 'c')).toBe(false);
      expect(delegationHashSetAdd(full, 'a', 2), 'a text already in a full set is still present').toBe(true);
    });

    it('control: with no marks each world links', () => {
      for (const [name, i] of [['rung 2', rung2(DELEGATION_NO_MARKS)], ['rung 2 (workflow)', wfRung2(DELEGATION_NO_MARKS)], ['rung 3', rung3(DELEGATION_NO_MARKS)], ['rung 4', rung4(DELEGATION_NO_MARKS)]] as const) {
        expect(correlateDelegation(i).kind, name).toBe('linked');
      }
    });

    it('a path mark: the tree\'s own path hashed in the set makes a rung-2 or rung-3 link unmeasured; another path does not', () => {
      expect(horizon(correlateDelegation(rung3(marks({ paths: [setOf(C)] }))))).toBe(true);
      expect(correlateDelegation(rung3(marks({ paths: [setOf(`${C}/sub`)] }))).kind).toBe('linked');
      expect(horizon(correlateDelegation(rung3(marks({ paths: [setOf('/fixture/x'), setOf(C)] })))), 'in any project\'s set').toBe(true);
      expect(horizon(correlateDelegation(rung2(marks({ paths: [setOf(WT(`agent-${AGENT}`))] }))))).toBe(true);
    });

    it('an id mark: the activity\'s upstream id (or, for a workflow worker, its run) hashed in the set makes the link unmeasured', () => {
      expect(horizon(correlateDelegation(rung3(marks({ ids: setOf(AGENT) }))))).toBe(true);
      expect(horizon(correlateDelegation(rung2(marks({ ids: setOf(AGENT) }))))).toBe(true);
      expect(horizon(correlateDelegation(wfRung2(marks({ ids: setOf('wf_run1') }))))).toBe(true);
      expect(correlateDelegation(rung3(marks({ ids: setOf(AGENT_2) }))).kind).toBe('linked');
    });

    it('a lost project: every rung-2 or rung-3 link of a tree in it is unmeasured; a tree of another project is not', () => {
      expect(horizon(correlateDelegation(rung3(marks({ projects: new Set([REPO]) }))))).toBe(true);
      expect(horizon(correlateDelegation(rung2(marks({ projects: new Set([REPO]) }))))).toBe(true);
      expect(correlateDelegation(rung3(marks({ projects: new Set(['project-b']) }))).kind).toBe('linked');
    });

    it('the global flag: every rung-2 and rung-3 link is unmeasured; rung 4, which no forgotten key can veto, still links', () => {
      const lossy = marks({ lossy: true });
      for (const i of [rung2(lossy), wfRung2(lossy), rung3(lossy)]) expect(horizon(correlateDelegation(i))).toBe(true);
      expect(correlateDelegation(rung4(lossy)).kind).toBe('linked');
    });

    it('a verdict that was not a link is unchanged by any mark', () => {
      const all = marks({ lossy: true, projects: new Set([REPO]), prefixes: new Set([C]), paths: [setOf(C)], ids: setOf(AGENT) });
      const cases: DelegationCorrelationInput[] = [
        input({ hasRegistryRow: true }), input({ birthPassesRemaining: 2 }), agentWorld({ pointMetas: [] }).base,
        input({ record: record({ state: 'unreadable' }) }), input({ record: record({ canonicalPath: null }) }),
      ];
      for (const c of cases) expect(correlateDelegation({ ...c, droppedEvidence: withMarks(all) })).toEqual(correlateDelegation(c));
    });

    it('delegationMarkForced names the kind of mark that changed a verdict, and nothing for a verdict no mark changed', () => {
      const ask = (i: DelegationCorrelationInput) => delegationMarkForced(i, correlateDelegation(i));
      expect(ask(rung3(marks({ paths: [setOf(C)] })))).toBe('path');
      expect(ask(rung3(marks({ ids: setOf(AGENT) })))).toBe('id');
      expect(ask(rung3(marks({ projects: new Set([REPO]) })))).toBe('project');
      expect(ask(rung3(marks({ lossy: true, paths: [setOf(C)] })))).toBe('lossy');
      expect(ask(rung3(DELEGATION_NO_MARKS)), 'a link').toBeNull();
      const e = evicting([toolAt(1, undefined, C), subagentStart(20, AGENT, { cwd: ELSEWHERE }), toolAt(22, AGENT, C)], [0]);
      const real = input({ record: rec, activities: e.w.activities, acceptedEvidence: e.held, droppedEvidence: indexDelegationDropped([delegationDroppedKeyOf(toolAt(1, undefined, C))], marks({ paths: [setOf(C)] })) });
      expect(horizon(correlateDelegation(real))).toBe(true);
      expect(ask(real), 'the held key vetoes by itself: the mark changed nothing').toBeNull();
      expect(ask({ ...rung3(DELEGATION_NO_MARKS), droppedEvidence: DELEGATION_DROPPED_UNMEASURED }), 'an unmeasured index is not a mark').toBeNull();
    });

    it('R77 (N19): a lost project\'s attributing prefix covers every tree at or under it, whatever repository it is in; a tree below, beside or elsewhere is not covered', () => {
      const up = C.slice(0, C.lastIndexOf('/'));
      for (const prefix of [C, up, `/fixture/${REPO}`]) expect(horizon(correlateDelegation(rung3(marks({ prefixes: new Set([prefix]) })))), prefix).toBe(true);
      for (const prefix of [WT(`agent-${AGENT}`), up]) expect(horizon(correlateDelegation(rung2(marks({ prefixes: new Set([prefix]) })))), `rung 2, ${prefix}`).toBe(true);
      expect(correlateDelegation(rung3(marks({ prefixes: new Set([`${C}/sub`, `${C}-sibling`, '/fixture/project-b']) }))).kind).toBe('linked');
      expect(correlateDelegation(rung4(marks({ prefixes: new Set([up]) }))).kind, 'rung 4 reads no key and no mark').toBe('linked');
      const covered = rung3(marks({ prefixes: new Set([up]) }));
      expect(delegationMarkForced(covered, correlateDelegation(covered)), 'counted apart from the path and project marks').toBe('prefix');
      const both = rung3(marks({ projects: new Set([REPO]), prefixes: new Set([up]) }));
      expect(delegationMarkForced(both, correlateDelegation(both)), 'the first of flag, project, prefix, path, id').toBe('project');
    });

    it('R77: the attribution names the prefix that attributed a mark (the nearest tree, else the checkout under a resolved root); an unresolved root attributes nothing by the root', () => {
      const trees = new Map([['/fixture/projects/project-b/.claude/worktrees/t', 'project-b']]);
      expect(delegationMarkAttributionOf('/fixture/projects/project-b/.claude/worktrees/t/x/y', '/fixture/projects', trees)).toEqual({ project: 'project-b', prefix: '/fixture/projects/project-b/.claude/worktrees/t' });
      expect(delegationMarkAttributionOf('/fixture/projects/project-a/nest/raw', '/fixture/projects/', trees)).toEqual({ project: 'project-a', prefix: '/fixture/projects/project-a' });
      expect(delegationMarkAttributionOf('/fixture/projects/project-a/nest/raw', DELEGATION_ROOT_UNMEASURED, trees), 'never the configured spelling').toBeNull();
      expect(delegationMarkAttributionOf('/fixture/projects/project-b/.claude/worktrees/t/x', DELEGATION_ROOT_UNMEASURED, trees), 'the nearest tree still attributes')
        .toEqual({ project: 'project-b', prefix: '/fixture/projects/project-b/.claude/worktrees/t' });
      expect(delegationMarkAttributionOf('/elsewhere/x', '/fixture/projects', trees)).toBeNull();
    });

    it('a correlation input carrying marks stays plain data: it clones, and an empty one freezes', () => {
      const i = rung3(marks({ paths: [setOf(C)] }));
      expect(horizon(correlateDelegation(structuredClone(i)))).toBe(true);
      expect(() => deepFreeze(structuredClone(rung3(DELEGATION_NO_MARKS)))).not.toThrow();
    });
  });
});

describe('the verdict reasons are one closed list (m4)', () => {
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'coord', 'delegation-correlation.ts');
  const src = readFileSync(file, 'utf8');
  const emitted = new Set([...src.matchAll(/\b(?:unresolved|conflicting|unmeasured)\('([a-z0-9-]+)'/g)].map((m) => m[1]!));
  it('every reason the module emits is in the list, and every listed reason is emitted somewhere', () => {
    expect([...emitted].sort()).toEqual([...DELEGATION_CORRELATION_REASONS].sort());
  });
  it('the list has no duplicate and the two reasons Task 12 must branch on are in it', () => {
    expect(new Set(DELEGATION_CORRELATION_REASONS).size).toBe(DELEGATION_CORRELATION_REASONS.length);
    expect(DELEGATION_CORRELATION_REASONS).toEqual(expect.arrayContaining(['ccrc-birth-wait', 'ccd-workspace-not-a-lease']));
  });
  it('a verdict built by the ladder carries only listed reasons, across the refusal cases this file exercises', () => {
    const seen = new Set<string>();
    const { base } = agentWorld();
    for (const over of [
      { hasRegistryRow: true }, { birthPassesRemaining: 2 as const }, { pointMetas: [] }, { activities: [] },
      { record: record({ state: 'unreadable' as const }) }, { record: record({ state: 'absent' as const }) }, { record: record({ canonicalPath: null }) },
    ]) {
      const v = correlateDelegation({ ...base, ...over });
      if (v.kind === 'unresolved' || v.kind === 'conflicting' || v.kind === 'unmeasured') seen.add(v.reason);
    }
    for (const reason of seen) expect(DELEGATION_CORRELATION_REASONS as readonly string[]).toContain(reason);
    expect(seen.size).toBeGreaterThan(4);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// the module itself: pure, deterministic, and it changes nothing it is handed
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

describe('the correlation module is L1: pure, with no clock, no randomness and no IO', () => {
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'coord', 'delegation-correlation.ts');
  const code = readFileSync(file, 'utf8').split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');
  it('imports shared/api.ts (L0) and the pure model only', () => {
    const specs = [...code.matchAll(/^import\s[^;]*?from\s+'([^']+)';/gms)].map((m) => m[1]);
    expect(specs.sort()).toEqual(['../../../shared/api.js', './delegation-model.js']);
  });
  it('names no filesystem, process, store, clock or random source', () => {
    expect(code).not.toMatch(/node:fs|node:path|node:sqlite|node:crypto|fastify|CoordStore|process\.|readFileSync|writeFileSync|\bDate\.now\b|\bnew Date\(|performance\.now|\brandomUUID\b|\brandomBytes\b|Math\.random|\bsetTimeout\b|\bawait\b|\basync\b/);
  });
  it('never reads the fold fields of a census record (locked, baseAgreesFirstLog) or a branch/sha/base as evidence', () => {
    expect(code).not.toMatch(/\.locked\b|\.baseAgreesFirstLog\b|\.headBranch\b|\.headSha\b|\.claudeBase\b|\.displayName\b|\.diagnostic\b/);
  });
  it('spells `conflicting` and never the variant `conflicted`', () => {
    expect(code).toMatch(/'conflicting'/);
    expect(code).not.toMatch(/conflicted/);
  });
});

describe('purity of the call: no argument is changed, and the same input gives the same verdict', () => {
  it('a deeply frozen input is accepted and answers deterministically, for every kind of verdict', () => {
    const linked = agentWorld().base;
    const rawWorld = world([bashPre(10, 'toolu_b1', ['main-wt']), bashPost(12, 'toolu_b1', ['main-wt', RAW])]);
    const inputs: DelegationCorrelationInput[] = [
      linked,
      { ...linked, runChildAgreement: { activityId: 'a', evidenceJournalIds: ['j'] } },
      { ...linked, birthPassesRemaining: 1 },
      { ...linked, pointMetas: [] },
      { ...linked, pointMetas: [...linked.pointMetas, { ...linked.pointMetas[0]!, worktreePath: '/x' }] },
      input({ record: rawRecord(), activities: rawWorld.activities, acceptedEvidence: rawWorld.acceptedEvidence, listingWindows: [win({ after: ['main-wt', RAW] })] }),
      { ...linked, record: { ...linked.record, state: 'unreadable' } },
    ];
    const seen = new Set<string>();
    for (const i of inputs) {
      const copy = structuredClone(i);
      const frozen = deepFreeze(structuredClone(i));
      const a = correlateDelegation(frozen);
      const b = correlateDelegation(frozen);
      expect(a).toEqual(b);
      expect(frozen).toEqual(copy);
      seen.add(kindOf(a));
    }
    expect([...seen].sort()).toEqual(['conflicting', 'linked', 'run-child-owned', 'unmeasured', 'unresolved']);
  });
  it('the evidence list of a verdict is sorted, de-duplicated, and independent of the order evidence was handed over', () => {
    const { base } = agentWorld();
    const forward = correlateDelegation(base);
    const reversed = correlateDelegation({ ...base, acceptedEvidence: [...base.acceptedEvidence].reverse(), activities: [...base.activities].reverse() });
    expect(reversed).toEqual(forward);
    expect(forward.evidenceJournalIds).toEqual(sorted(forward.evidenceJournalIds));
  });
});

describe('the natural key the ladder depends on is the model\'s, not a second spelling', () => {
  it('an activity found by the ladder is the one whose natural-key encoding the model derives', () => {
    const { w } = agentWorld();
    const a = activityOf(w.activities, 'agent', AGENT)!;
    expect(w.cp.activityIdsByNaturalKey[encodeDelegationNaturalKey(keyOf('agent', AGENT))]).toBe(a.activityId);
  });
});
