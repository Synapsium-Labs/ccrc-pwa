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
  DELEGATION_CORRELATION_REASONS,
  DELEGATION_EVIDENCE_MARGIN_MS,
  correlateDelegation,
  delegationLeaseSourceOfLinked,
  type DelegationCorrelationInput,
  type DelegationCorrelationVerdict,
  type DelegationListingWindow,
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
  birthPassesRemaining: 0, hasRegistryRow: false, hasChildMarker: false, evidenceHorizon: null, ...over,
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

  it('a Workflow worker waits for a retained record naming its RUN: a meta alone chooses no identity', () => {
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
    w.builder.clone().openWorkflowWorkerFromMeta(PARENT, INC, 'wf_run1', 1);
    const fresh = w.builder.clone();
    fresh.openWorkflowWorkerFromMeta(PARENT, INC, 'wf_run1', 1);
    expect(worker.activityId).toBe(activityOf(fresh.build(1).activities, 'workflow', 'wf_run1-1')!.activityId);
    expect(worker.activityId).toBe(deriveDelegationActivityId(keyOf('workflow', 'wf_run1-1'), w.records[0]!.journalId));
  });
  it('recovery from a checkpoint plus the retained suffix restores the same run identity', () => {
    const early = recoverDelegation(null, w.records.slice(0, 2)).state.checkpoint;           // the launch is covered; X more records follow
    expect(activityOf(early.activities, 'workflow', 'wf_run1')!.activityId).toBe(runRow.activityId);
    const resumed = recoverDelegation(encodeDelegationCheckpoint(early), w.records);
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

  it('rung 4, the margin: a candidate window that began less than one evidence margin after the horizon is unmeasured; exactly one margin after, it links', () => {
    expect(MARGIN).toBeGreaterThan(0);
    const horizon = at(0);
    expect(decide([winAt(MARGIN - 1, MARGIN + 5_000)], horizon).kind).toBe('unmeasured');
    expect(decide([winAt(MARGIN, MARGIN + 5_000)], horizon).kind).toBe('linked');
    expect(decide([winAt(1, 5_000)], horizon).kind, 'a window that began after the horizon by less than a margin').toBe('unmeasured');
    expect(decide([winAt(-5_000, -1)], horizon).kind, 'a window wholly before the horizon').toBe('unmeasured');
    const v = decide([winAt(MARGIN - 1, MARGIN + 5_000)], horizon);
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

  it('rung 2 (agent): a claim set that reaches back to the horizon is unmeasured; one wholly after it links', () => {
    const { w, base } = agentWorld();
    const opened = activityOf(w.activities, 'agent', AGENT)!.openedAt;
    expect(opened).toBe(T(1));
    const at1 = (horizon: string | null) => correlateDelegation({ ...base, evidenceHorizon: horizon });
    expect(at1(null).kind).toBe('linked');
    expect(at1(T(0)).kind, 'the horizon is before the first claim').toBe('linked');
    const exactly = at1(T(1));
    expect(exactly.kind, 'AT the identity record').toBe('unmeasured');
    expect(exactly.kind === 'unmeasured' && exactly.reason).toBe('evidence-horizon');
    expect(at1(T(5)).kind, 'after it').toBe('unmeasured');
  });

  it('rung 2 (agent): the EARLIEST naming record counts, not the join: a bare occurrence before the launch is where the claim set begins', () => {
    const w = world([bareTool(1, AGENT), agentLaunch(2, AGENT), subagentStart(3, AGENT)]);
    const act = activityOf(w.activities, 'agent', AGENT)!;
    expect(act.openedAt).toBe(T(1));
    const base = input({ activities: w.activities, acceptedEvidence: w.acceptedEvidence, pointMetas: [meta({ evidenceJournalId: w.records[1]!.journalId })] });
    expect(correlateDelegation({ ...base, evidenceHorizon: T(0) }).kind).toBe('linked');
    expect(correlateDelegation({ ...base, evidenceHorizon: T(1) }).kind).toBe('unmeasured');
    expect(correlateDelegation({ ...base, evidenceHorizon: T(2) }).kind).toBe('unmeasured');
  });

  it('rung 2 (workflow): the worker\'s identity record is the run\'s: a horizon at or after it is unmeasured', () => {
    const w = world([workflowLaunch(1, 'wf_run1'), subagentStart(2, AGENT)]);
    w.builder.openWorkflowWorkerFromMeta(PARENT, INC, 'wf_run1', 1);
    const activities = w.builder.build(1).activities;
    const m = meta({ sourceKind: 'workflow', upstreamId: 'wf_run1-1', worktreePath: WT('wf_run1-1'), evidenceJournalId: w.records[0]!.journalId });
    const base = input({ record: record({ adminRecord: 'wf_run1-1', canonicalPath: WT('wf_run1-1') }), activities, acceptedEvidence: w.acceptedEvidence, pointMetas: [m] });
    expect(correlateDelegation(base).kind).toBe('linked');
    expect(correlateDelegation({ ...base, evidenceHorizon: T(0) }).kind).toBe('linked');
    const v = correlateDelegation({ ...base, evidenceHorizon: T(1) });
    expect(v.kind === 'unmeasured' && v.reason).toBe('evidence-horizon');
  });

  it('rung 3: a subagent whose first claim is at or before the horizon is unmeasured; after it, it links', () => {
    const toolIn = (n: number): DelegationEventEnvelopeV1 =>
      ({ ...base(n, { cwd: WT(RAW) }), eventKind: 'PostToolUse', toolName: 'Bash', toolUseId: `toolu_${n}`, outcome: 'completed', agentId: AGENT });
    const w = world([subagentStart(1, AGENT), toolIn(2)]);
    const go = (horizon: string | null) => correlateDelegation(input({ record: rec, activities: w.activities, acceptedEvidence: w.acceptedEvidence, evidenceHorizon: horizon }));
    expect(go(null).kind).toBe('linked');
    expect(go(T(0)).kind).toBe('linked');
    const v = go(T(1));
    expect(v.kind).toBe('unmeasured');
    expect(v.kind === 'unmeasured' && v.reason).toBe('evidence-horizon');
    expect(go(T(2)).kind).toBe('unmeasured');
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
  it('imports shared/api.ts types and the pure model only', () => {
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
