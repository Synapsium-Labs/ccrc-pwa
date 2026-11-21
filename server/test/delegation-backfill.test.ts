// Session helpers S2 (D-8874; spec docs/superpowers/specs/2026-11-19-session-helpers-design.md §7.2, Table 10, Table 13's S2 row;
// plan docs/superpowers/plans/2026-11-20-broker-helper-ends.md, Task S2): the ONE-TIME PASS over the broker's old open records, dry
// run first. Its decisions (`delegation-backfill.ts`, L1), the builder's two thin methods, and the durability layer's three entries
// (the dry run, the pass, the undo), each run inside the applier's queue, the pass and the undo through `commitLocked`.
//
// Red first: against `origin/main` 137f96672c every case of this file is red, because the module, the builder methods and the
// durability entries it reaches do not exist there (the file fails to load). The readers of Table 10, which `main` already has, are
// reached by behaviour in `delegation-backfill-readers.test.ts`, so each of those reds on its own assertion. Every file is in a FIXTURE
// directory: nothing reads or writes the live `~/.ccrc`, and the pass never runs against the live server.
import { afterEach, describe, it, expect } from 'vitest';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { DelegationEventEnvelopeV1 } from '../../shared/api.js';
import { DELEGATION_BACKFILL_WORDS } from '../../shared/delegationBackfill.js';
import {
  delegationSha256Hex,
  emptyDelegationCheckpoint,
  encodeDelegationNaturalKey,
  formatDelegationInstant,
  type DelegationActivityRow,
  type DelegationCheckpointV1,
  type DelegationJournalRecordV1,
} from '../src/coord/delegation-model.js';
import { DELEGATION_JOURNAL_FILE, buildDelegationJournalRecord, encodeDelegationJournalRecord, type DelegationFileHandle, type DelegationFilePort } from '../src/coord/delegation-journal.js';
import { DELEGATION_CHECKPOINT_FILE, DelegationCheckpointBuilder, decodeDelegationCheckpoint, encodeDelegationCheckpoint } from '../src/coord/delegation-checkpoint.js';
import { DelegationDurability } from '../src/coord/delegation-durability.js';
import type { DelegationProjectionPort } from '../src/coord/delegation-db-projection.js';
import { nodeDelegationFilePort } from '../src/coord/delegation-file-port.js';
import {
  DELEGATION_BACKFILL_FILE,
  DELEGATION_BACKFILL_PROVEN_QUIET_MS,
  DELEGATION_BACKFILL_QUIET_MS,
  backfillClosed,
  backfillParentsToRead,
  backfillReopened,
  backfillVerdict,
  decodeBackfillList,
  encodeBackfillList,
  planDelegationBackfill,
  workerUnderRun,
  type DelegationBackfillParent,
} from '../src/coord/delegation-backfill.js';
import { mkTmp } from './tmpHelpers.js';

// ── fixtures ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

type Row = DelegationActivityRow;
const P = 'lane-a-demo';
const Q = 'lane-b-demo';
const INC = 'g1';
const INC2 = 'g2';
const CLAUDE = '11111111-2222-3333-4444-555555555555';
const H = 3_600_000;
const DAY = 24 * H;
const T0 = Date.UTC(2026, 9, 20, 12);
const at = (ms: number): string => formatDelegationInstant(T0 + ms);
const absent: DelegationBackfillParent = { kind: 'absent' };
const measured = (incarnation: string): DelegationBackfillParent => ({ kind: 'measured', incarnation });
const unmeasured: DelegationBackfillParent = { kind: 'unmeasured' };

/** A row by hand: open, opened and last seen at T0, under (P, INC). */
const row = (activityId: string, over: Partial<Row> = {}): Row => ({
  activityId, parentId: P, parentIncarnation: INC, sourceKind: 'agent', upstreamId: activityId, identityJournalId: 'a'.repeat(64),
  displayName: null, executionState: 'active', openedAt: at(0), endedAt: null, lastEventAt: at(0), ...over,
});
const rowsOf = (...rows: Row[]): Map<string, Row> => new Map(rows.map((a) => [a.activityId, a] as const));
const plan = (activities: Row[], nowMs: number, over: { parents?: Map<string, DelegationBackfillParent>; listed?: Set<string> | null;
  reported?: Set<string> | null; leases?: string[]; lineage?: string[] } = {}) =>
  planDelegationBackfill({
    checkpoint: { activities, leases: (over.leases ?? []).map((activityId) => ({ activityId })) as never, lineage: (over.lineage ?? []).map((activityId) => ({ activityId })) as never },
    nowMs, parents: over.parents ?? new Map(), listed: over.listed ?? null, reported: over.reported ?? null,
  });

let serial = 0;
const base = (ms: number, over: { sessionId?: string; parentIncarnation?: string } = {}) => {
  const n = ++serial;
  return {
    v: 1 as const, observedAt: at(ms), sessionId: over.sessionId ?? P, parentIncarnation: over.parentIncarnation ?? INC, claudeSessionId: CLAUDE,
    eventId: delegationSha256Hex(`s2-event-${n}`), bucket: '2026102012', startOffset: n * 100, endOffset: n * 100 + 99,
  };
};
type Ev = DelegationEventEnvelopeV1;
const sessionStart = (ms: number, source: 'startup' | 'compact' | 'resume' = 'startup', over = {}): Ev => ({ ...base(ms, over), eventKind: 'SessionStart', source });
const subagentStart = (ms: number, agentId: string, over = {}): Ev => ({ ...base(ms, over), eventKind: 'SubagentStart', agentId, agentType: null });
const workflowLaunch = (ms: number, runId: string): Ev =>
  ({ ...base(ms), eventKind: 'PostToolUse', toolName: 'Workflow', toolUseId: `toolu_wf_${runId}`, outcome: 'async-launched',
    launch: { status: 'async-launched', taskId: `task_${runId}`, taskType: 'local_workflow', workflowName: 'review-pass', runId, transcriptDir: `transcripts/${runId}`, scriptPath: 'scripts/review-pass.js' } });
const notification = (ms: number, taskId: string, toolUseId: string, status: 'completed' | 'unknown' = 'completed'): Ev =>
  ({ ...base(ms), eventKind: 'UserPromptSubmit', notification: { taskId, toolUseId, status } });
/** A subagent's own tool call, which names its agent id and is no qualifying join: it makes the agent an identity CANDIDATE only. */
const agentToolCall = (ms: number, agentId: string): Ev =>
  ({ ...base(ms), eventKind: 'PreToolUse', toolName: 'Agent', toolUseId: `toolu_inner_${agentId}`, isolation: null, agentId });

function chain(events: readonly Ev[], first = 1, previous: string | null = null): DelegationJournalRecordV1[] {
  const out: DelegationJournalRecordV1[] = [];
  let prev = previous;
  events.forEach((event, i) => {
    const r = buildDelegationJournalRecord({ sequence: first + i, acceptedAt: formatDelegationInstant(Date.parse(event.observedAt) + 1000), previousDigest: prev, entry: { kind: 'evidence-accepted', event } });
    out.push(r);
    prev = r.digest;
  });
  return out;
}

const noSync = (h: DelegationFileHandle): DelegationFileHandle => ({ write: (b) => h.write(b), sync: async () => undefined, close: () => h.close() });
const quickPort: DelegationFilePort = {
  ...nodeDelegationFilePort,
  openAppend: async (p) => noSync(await nodeDelegationFilePort.openAppend(p)),
  createTemp: async (p) => noSync(await nodeDelegationFilePort.createTemp(p)),
  fsyncDir: async () => undefined,
  fsyncFile: async () => undefined,
};
/** A projection that holds nothing: these cases are about the checkpoint and the list (SQLite's column is pinned by the route file). */
const nullProjection: DelegationProjectionPort = {
  project: () => undefined, projectChanged: () => ({ mode: 'full' }), insertEvents: (rows) => ({ inserted: rows.length, duplicate: 0, conflicts: [] }),
  eventStats: () => ({ count: 0, maxSequence: null }), countEventsAtOrBelow: () => 0, deleteEventsBetween: () => 0,
};
const opened: DelegationDurability[] = [];
afterEach(async () => { await Promise.all(opened.splice(0).map((d) => d.close().catch(() => undefined))); });
async function applierOver(dir: string): Promise<DelegationDurability> {
  const d = await DelegationDurability.open({ dir, projection: nullProjection, now: () => T0 + 40 * DAY, randomUUID: () => 'unused', port: quickPort });
  opened.push(d);
  expect(d.failure(), 'the applier is ready').toBeNull();
  return d;
}
/** A fixture directory holding `records` as its journal and no checkpoint: the applier rebuilds from the journal alone. */
function dirWith(records: readonly DelegationJournalRecordV1[]): string {
  const dir = mkTmp('ccrc-s2-');
  writeFileSync(path.join(dir, DELEGATION_JOURNAL_FILE), Buffer.concat(records.map((r) => Buffer.from(encodeDelegationJournalRecord(r)))));
  return dir;
}
const checkpointBytes = (dir: string): Buffer => readFileSync(path.join(dir, DELEGATION_CHECKPOINT_FILE));
const diskCheckpoint = (dir: string): DelegationCheckpointV1 => decodeDelegationCheckpoint(new Uint8Array(checkpointBytes(dir)));
const agentOf = (cp: DelegationCheckpointV1, agentId: string, parentId = P): Row | undefined =>
  cp.activities.find((a) => a.sourceKind === 'agent' && a.upstreamId === agentId && a.parentId === parentId);
const runOf = (cp: DelegationCheckpointV1, runId: string): Row | undefined => cp.activities.find((a) => a.sourceKind === 'workflow' && a.upstreamId === runId);
const listOf = (dir: string): string[] => {
  const got = decodeBackfillList(new Uint8Array(readFileSync(path.join(dir, DELEGATION_BACKFILL_FILE))));
  if (!got.ok) throw new Error(got.detail);
  return [...got.ids].sort();
};
/** The parents the route would read, measured by hand: P at INC (alive, the same incarnation), Q absent from the registry. */
const LIVE_P_GONE_Q = new Map<string, DelegationBackfillParent>([[P, measured(INC)], [Q, absent]]);

// ── one record's verdict (spec §7.2's five conditions) ───────────────────────────────────────────────────────────────

describe('S2: one record\'s verdict', () => {
  it('B-V1: a record quiet for less than 24 hours is untouched, whatever its kind and its parent', () => {
    const now = T0 + DELEGATION_BACKFILL_QUIET_MS - 1;
    for (const sourceKind of ['agent', 'workflow', 'bash-worktree'] as const) {
      expect(backfillVerdict(row('x', { sourceKind }), now, absent), sourceKind).toBe('young');
    }
    expect(backfillVerdict(row('x', { sourceKind: 'bash-worktree' }), now + 1, undefined), 'at exactly 24 hours it qualifies').toBe('close');
  });

  it('B-V2: a bash-worktree record quiet for 24 hours closes by its quiet alone; its parent is never read', () => {
    const now = T0 + DAY;
    for (const parent of [undefined, unmeasured, measured(INC), absent]) {
      expect(backfillVerdict(row('b', { sourceKind: 'bash-worktree' }), now, parent)).toBe('close');
    }
  });

  it('B-V3: an agent or workflow record quiet for 24 hours closes on a positive check: parent absent, or another incarnation', () => {
    const now = T0 + 2 * DAY;
    for (const sourceKind of ['agent', 'workflow'] as const) {
      expect(backfillVerdict(row('x', { sourceKind }), now, absent), `${sourceKind}, parent absent`).toBe('close');
      expect(backfillVerdict(row('x', { sourceKind }), now, measured(INC2)), `${sourceKind}, another incarnation`).toBe('close');
      expect(backfillVerdict(row('x', { sourceKind }), now, measured(INC)), `${sourceKind}, the same incarnation`).toBe('unchecked');
      expect(backfillVerdict(row('x', { sourceKind }), now, unmeasured), `${sourceKind}, unmeasured`).toBe('unchecked');
      expect(backfillVerdict(row('x', { sourceKind }), now, undefined), `${sourceKind}, no fact read`).toBe('unchecked');
    }
  });

  it('B-V4: quiet for 7 days is the positive check\'s third arm, whatever the parent; a millisecond less is not', () => {
    const at7 = T0 + DELEGATION_BACKFILL_PROVEN_QUIET_MS;
    expect(backfillVerdict(row('x'), at7, measured(INC))).toBe('close');
    expect(backfillVerdict(row('x'), at7, unmeasured)).toBe('close');
    expect(backfillVerdict(row('x'), at7 - 1, measured(INC))).toBe('unchecked');
    expect(backfillVerdict(row('x', { sourceKind: 'workflow' }), at7 - 1, unmeasured)).toBe('unchecked');
  });

  it('B-V5: quiet is measured from lastEventAt, not from openedAt', () => {
    const now = T0 + 10 * DAY;
    expect(backfillVerdict(row('x', { lastEventAt: at(10 * DAY - H) }), now, absent)).toBe('young');
  });

  it('B-V6: a record that is not open is never touched: ended by any basis, and unknown (no writer)', () => {
    const now = T0 + 40 * DAY;
    expect(backfillVerdict(row('x', { executionState: 'ended', endedAt: at(1) }), now, absent)).toBe('ended');
    expect(backfillVerdict(row('x', { executionState: 'ended', endedAt: at(1), endBasis: 'task-report' }), now, absent)).toBe('ended');
    expect(backfillVerdict(row('x', { executionState: 'ended', endedAt: null, endBasis: 'backfill-unmeasured' }), now, absent)).toBe('ended');
    expect(backfillVerdict(row('x', { executionState: 'unknown' }), now, absent)).toBe('ended');
  });

  it('B-V7: only the parents a verdict reads are asked for: open agent and workflow records quiet for 24 hours and under 7 days', () => {
    const now = T0 + 3 * DAY;
    const rows = [
      row('a1', { parentId: 'p-young', lastEventAt: at(3 * DAY - H) }),                       // young: no read
      row('a2', { parentId: 'p-mid' }),                                                       // quiet 3 days: read
      row('w1', { parentId: 'p-wf', sourceKind: 'workflow' }),                                // read
      row('b1', { parentId: 'p-bash', sourceKind: 'bash-worktree' }),                         // bash: no read
      row('a3', { parentId: 'p-old', lastEventAt: at(-5 * DAY) }),                            // quiet 8 days: no read
      row('a4', { parentId: 'p-ended', executionState: 'ended', endedAt: at(1) }),            // ended: no read
      row('a5', { parentId: 'p-mid' }),                                                       // a repeat
    ];
    expect(backfillParentsToRead(rows, now)).toEqual(['p-mid', 'p-wf']);
  });
});

// ── the plan and the dry run's report ────────────────────────────────────────────────────────────────────────────────

describe('S2: the plan and the dry run\'s report (spec §7.2, condition 4)', () => {
  const now = T0 + 40 * DAY;
  const fixture = (): Row[] => [
    row('a-old', { openedAt: at(0), lastEventAt: at(DAY) }),                                          // 40 days: closes (7-day quiet)
    row('a-gone', { parentId: Q, openedAt: at(36 * DAY), lastEventAt: at(36 * DAY) }),               // 4 days, parent absent: closes
    row('a-live', { openedAt: at(36 * DAY), lastEventAt: at(36 * DAY) }),                            // 4 days, same incarnation: fails
    row('w-gone', { parentId: Q, sourceKind: 'workflow', openedAt: at(20 * DAY), lastEventAt: at(36 * DAY) }),  // opened 20 days ago
    row('b-old', { sourceKind: 'bash-worktree', openedAt: at(2 * DAY), lastEventAt: at(2 * DAY) }),  // 38 days
    row('b-young', { sourceKind: 'bash-worktree', openedAt: at(40 * DAY - H), lastEventAt: at(40 * DAY - H) }),
    row('a-ended', { executionState: 'ended', endedAt: at(5) }),
    row('a-done', { executionState: 'ended', endedAt: null, endBasis: 'backfill-unmeasured' }),
  ];

  it('B-P1: the count it would close, by kind and by how long ago each was opened; ids sorted; the words', () => {
    const p = plan(fixture(), now, { parents: LIVE_P_GONE_Q });
    expect(p.close).toEqual(['a-gone', 'a-old', 'b-old', 'w-gone']);
    expect(p.report).toMatchObject({ words: DELEGATION_BACKFILL_WORDS, asOf: formatDelegationInstant(now), mode: 'first', listed: null, closes: 4 });
    expect(p.report.byKind).toEqual({
      agent: { days1to7: 1, days7to30: 0, days30plus: 1 },
      workflow: { days1to7: 0, days7to30: 1, days30plus: 0 },
      'bash-worktree': { days1to7: 0, days7to30: 0, days30plus: 1 },
    });
  });

  it('B-P2: how many failed the positive check, how many are young, how many the pass already closed', () => {
    const p = plan(fixture(), now, { parents: LIVE_P_GONE_Q });
    expect(p.report).toMatchObject({ failedCheck: 1, young: 1, closed: 1, unlisted: 0, reportedFirst: null });
  });

  it('B-P3: how many of those it would close a lease or a lineage row names (released or not, open or closed)', () => {
    const p = plan(fixture(), now, { parents: LIVE_P_GONE_Q, leases: ['a-old', 'a-live'], lineage: ['b-old', 'a-ended'] });
    expect(p.report.named, 'a-old (a lease) and b-old (a lineage row); a-live and a-ended are not closed').toBe(2);
    expect(p.close, 'a named record still closes: lease liveness reads the basis (review 2900 F1)').toContain('a-old');
  });

  it('B-P4: after a pass, the recorded ids bound every later one (review 2900 F2): only those close, the rest are counted', () => {
    const p = plan(fixture(), now, { parents: LIVE_P_GONE_Q, listed: new Set(['a-old', 'w-gone', 'a-done', 'never-seen']) });
    expect(p.close).toEqual(['a-old', 'w-gone']);
    expect(p.report).toMatchObject({ mode: 'listed', listed: 4, closes: 2, unlisted: 2 });
  });

  it('B-P5: review 3026 F4: open or already closed agent records whose final notification the journal retains, counted', () => {
    const rows = fixture();
    const keyOf = (id: string): string => encodeDelegationNaturalKey(rows.find((a) => a.activityId === id)!);
    const reported = new Set([keyOf('a-live'), keyOf('a-done'), keyOf('a-ended'), keyOf('w-gone')]);
    expect(plan(rows, now, { parents: LIVE_P_GONE_Q, reported }).report.reportedFirst, 'a-live and a-done; a-ended has a measured end, w-gone is no agent').toBe(2);
  });

  it('B-P6: nothing open: nothing to close, and the report says so', () => {
    const p = plan([row('a-ended', { executionState: 'ended', endedAt: at(5) })], now);
    expect(p.close).toEqual([]);
    expect(p.report).toMatchObject({ closes: 0, failedCheck: 0, young: 0, closed: 0, named: 0 });
  });
});

// ── the rows the pass and the undo write ─────────────────────────────────────────────────────────────────────────────

describe('S2: the pass\'s rows and the undo\'s', () => {
  it('B-R1: the pass closes each listed open record: ended, no end time, the basis; nothing else changes', () => {
    const open = row('x', { lastEventAt: at(3) });
    const rows = rowsOf(open, row('e', { executionState: 'ended', endedAt: at(2) }), row('u', { executionState: 'unknown' }));
    expect(backfillClosed(rows, ['x', 'e', 'u', 'missing'])).toEqual([{ ...open, executionState: 'ended', endedAt: null, endBasis: 'backfill-unmeasured' }]);
  });

  it('B-R2: the undo reopens every record the basis names, and gives an untouched one back as it was', () => {
    const open = row('x', { lastEventAt: at(3) });
    const [closed] = backfillClosed(rowsOf(open), ['x']);
    expect(backfillReopened(rowsOf(closed!, row('e', { executionState: 'ended', endedAt: at(2) }), row('t', { executionState: 'ended', endedAt: at(2), endBasis: 'task-report' }))))
      .toEqual([open]);
  });

  it('B-R3: review 3026 F3: a worker opened under a run the pass closed is closed by it too; under any other run it is as opened', () => {
    const worker = row('w-0', { sourceKind: 'workflow' });
    const run = row('w', { sourceKind: 'workflow' });
    const [closedRun] = backfillClosed(rowsOf(run), ['w']);
    expect(workerUnderRun(worker, closedRun!)).toEqual({ ...worker, executionState: 'ended', endedAt: null, endBasis: 'backfill-unmeasured' });
    expect(workerUnderRun(worker, run)).toBe(worker);
    const endedRun = row('w', { sourceKind: 'workflow', executionState: 'ended', endedAt: at(9) });
    const endedWorker = { ...worker, executionState: 'ended' as const, endedAt: at(9) };
    expect(workerUnderRun(endedWorker, endedRun)).toBe(endedWorker);
  });

  it('B-R4: the list round-trips, and a list that does not read is refused, never read as empty', () => {
    expect(decodeBackfillList(encodeBackfillList(at(0), ['b', 'a']))).toEqual({ ok: true, ids: new Set(['a', 'b']) });
    for (const bad of ['', 'nope', '[]', '{"v":1,"at":"x"}', '{"v":2,"at":"x","ids":[]}', '{"v":1,"at":"x","ids":[1]}', '{"v":1,"at":"x","ids":[""]}', '{"v":1,"at":"x","ids":[],"more":1}']) {
      expect(decodeBackfillList(new TextEncoder().encode(bad)).ok, bad).toBe(false);
    }
  });
});

// ── the builder's two thin methods ───────────────────────────────────────────────────────────────────────────────────

describe('S2: the builder runs the pass and the undo (spec §7.2, condition 3)', () => {
  it('B-B1: closeByBackfill closes the given open records and nothing else; reopenBackfill gives them back byte for byte', () => {
    const records = chain([sessionStart(0), subagentStart(1000, 'agent-x'), subagentStart(2000, 'agent-y')]);
    const b = DelegationCheckpointBuilder.from(emptyDelegationCheckpoint());
    for (const r of records) b.foldRecord(r);
    const before = b.build(1);
    const x = agentOf(before, 'agent-x')!;
    expect(b.closeByBackfill([x.activityId, 'missing'])).toBe(1);
    const closed = b.build(2);
    expect(agentOf(closed, 'agent-x')).toEqual({ ...x, executionState: 'ended', endedAt: null, endBasis: 'backfill-unmeasured' });
    expect(agentOf(closed, 'agent-y'), 'y is untouched').toEqual(agentOf(before, 'agent-y'));
    expect(b.closeByBackfill([x.activityId]), 'a second close finds nothing open').toBe(0);
    expect(b.reopenBackfill()).toBe(1);
    expect(encodeDelegationCheckpoint({ ...b.build(1) })).toEqual(encodeDelegationCheckpoint(before));
    expect(b.reopenBackfill(), 'nothing left to reopen').toBe(0);
  });
});

// ── the durable dry run, pass and undo ───────────────────────────────────────────────────────────────────────────────

/** The fixture journal: P (alive at INC, with a later compact) started agent X and workflow run R; Q (gone) started agent Z. */
const journal = (): DelegationJournalRecordV1[] => chain([
  sessionStart(0), subagentStart(1000, 'agent-x'), workflowLaunch(2000, 'wf_r1'), sessionStart(3000, 'compact'),
  sessionStart(4000, 'startup', { sessionId: Q }), subagentStart(5000, 'agent-z', { sessionId: Q }),
]);
const NOW = T0 + 3 * DAY;

describe('S2: the durable dry run, pass and undo', () => {
  it('B-D1: the dry run writes nothing: no checkpoint byte, no revision, no list', async () => {
    const dir = dirWith(journal());
    const d = await applierOver(dir);
    const bytes = checkpointBytes(dir);
    const revision = d.state().checkpoint.revision;
    const report = await d.backfillDryRun(NOW, LIVE_P_GONE_Q);
    expect(report).toMatchObject({ mode: 'first', closes: 1, failedCheck: 2, reportedFirst: 0 });
    expect(checkpointBytes(dir).equals(bytes), 'the checkpoint is byte for byte as it was').toBe(true);
    expect(d.state().checkpoint.revision).toBe(revision);
    expect(existsSync(path.join(dir, DELEGATION_BACKFILL_FILE)), 'no list').toBe(false);
  });

  it('B-D2: a compact or a resume alone never passes the positive check: P\'s records stay open, Q\'s closes', async () => {
    const dir = dirWith(journal());
    const d = await applierOver(dir);
    const out = await d.backfillPass(NOW, LIVE_P_GONE_Q, 1);
    expect(out.ok).toBe(true);
    const cp = diskCheckpoint(dir);
    expect(agentOf(cp, 'agent-z', Q)).toMatchObject({ executionState: 'ended', endedAt: null, endBasis: 'backfill-unmeasured' });
    expect(agentOf(cp, 'agent-x'), 'P compacted, and is alive at the same incarnation').toMatchObject({ executionState: 'active', endedAt: null });
    expect(agentOf(cp, 'agent-x')).not.toHaveProperty('endBasis');
    expect(runOf(cp, 'wf_r1')).toMatchObject({ executionState: 'active' });
  });

  it('B-D3: the pass records the ids it closed before it closes them, and a second run closes nothing and writes nothing', async () => {
    const dir = dirWith(journal());
    const d = await applierOver(dir);
    const first = await d.backfillPass(NOW, LIVE_P_GONE_Q, 1);
    if (!first.ok) throw new Error('the first pass was refused');
    expect(first.closed).toBe(1);
    expect(listOf(dir)).toEqual([agentOf(diskCheckpoint(dir), 'agent-z', Q)!.activityId]);
    const bytes = checkpointBytes(dir);
    const second = await d.backfillPass(NOW, LIVE_P_GONE_Q, 0);
    expect(second).toMatchObject({ ok: true, closed: 0, applied: null });
    expect(checkpointBytes(dir).equals(bytes), 'a second run writes nothing').toBe(true);
  });

  it('B-D4: the pass refuses a count that is not the one it would close, and then writes nothing', async () => {
    const dir = dirWith(journal());
    const d = await applierOver(dir);
    const bytes = checkpointBytes(dir);
    const out = await d.backfillPass(NOW, LIVE_P_GONE_Q, 2);
    expect(out).toMatchObject({ ok: false, report: { closes: 1 } });
    expect(checkpointBytes(dir).equals(bytes)).toBe(true);
    expect(existsSync(path.join(dir, DELEGATION_BACKFILL_FILE))).toBe(false);
  });

  it('B-D5: records quiet for under 24 hours are untouched by the pass', async () => {
    const dir = dirWith(journal());
    const d = await applierOver(dir);
    const out = await d.backfillPass(T0 + DAY - 1, new Map([[P, absent], [Q, absent]]), 0);
    expect(out).toMatchObject({ ok: true, closed: 0, applied: null, report: { young: 3 } });
  });

  it('B-D6: the undo reopens exactly the records the pass closed, byte for byte, and keeps the list', async () => {
    const dir = dirWith(journal());
    const d = await applierOver(dir);
    const before = diskCheckpoint(dir);
    const out = await d.backfillPass(T0 + 8 * DAY, LIVE_P_GONE_Q, 3);
    expect(out).toMatchObject({ ok: true, closed: 3 });
    const undo = await d.backfillUndo();
    expect(undo.reopened).toBe(3);
    expect(encodeDelegationCheckpoint({ ...diskCheckpoint(dir), revision: 1 })).toEqual(encodeDelegationCheckpoint({ ...before, revision: 1 }));
    expect(listOf(dir), 'the list stays: the pass is one-time').toHaveLength(3);
    const bytes = checkpointBytes(dir);
    expect(await d.backfillUndo()).toMatchObject({ reopened: 0, applied: null });
    expect(checkpointBytes(dir).equals(bytes), 'nothing left to reopen writes nothing').toBe(true);
  });

  it('B-D7: a record an event touched after the pass reopens with the lastEventAt that event gave it', async () => {
    const dir = dirWith(journal());
    const d = await applierOver(dir);
    const before = runOf(diskCheckpoint(dir), 'wf_r1')!;
    expect(await d.backfillPass(T0 + 8 * DAY, LIVE_P_GONE_Q, 3)).toMatchObject({ ok: true });
    // A paused workflow's notification (`unknown`) touches its run without ending it.
    const touch = notification(8 * DAY + 5000, 'task_wf_r1', 'toolu_wf_wf_r1', 'unknown');
    await d.applyAccepted({ accepted: [{ event: touch }], cursor: null, interval: null });
    expect(runOf(diskCheckpoint(dir), 'wf_r1'), 'still closed by the pass: a touch is no measured end')
      .toMatchObject({ executionState: 'ended', endedAt: null, endBasis: 'backfill-unmeasured', lastEventAt: at(8 * DAY + 5000) });
    await d.backfillUndo();
    expect(runOf(diskCheckpoint(dir), 'wf_r1')).toEqual({ ...before, lastEventAt: at(8 * DAY + 5000) });
  });

  it('B-D8: review 2900 F2: after a rebuild from the journal alone, a re-run closes only the ids the first pass recorded', async () => {
    // Y starts 2.5 days in: young at the first pass, old enough at the re-run, and never on the list.
    const records = chain([...journal().map((r) => (r.entry as { event: Ev }).event), subagentStart(2 * DAY + 12 * H, 'agent-y', { sessionId: Q })]);
    const dir = dirWith(records);
    const first = await applierOver(dir);
    expect(await first.backfillPass(NOW, LIVE_P_GONE_Q, 1)).toMatchObject({ ok: true, closed: 1 });
    const listed = listOf(dir);
    await first.close();
    // The rebuild: the checkpoint is gone (an older server's reconstruction leaves one with no basis), the journal and the list stay.
    rmSync(path.join(dir, DELEGATION_CHECKPOINT_FILE));
    const again = await applierOver(dir);
    expect(agentOf(again.state().checkpoint as DelegationCheckpointV1, 'agent-z', Q), 'the rebuild reopened Z').toMatchObject({ executionState: 'active' });
    const later = NOW + 2 * DAY;
    const dry = await again.backfillDryRun(later, LIVE_P_GONE_Q);
    expect(dry).toMatchObject({ mode: 'listed', listed: 1, closes: 1, unlisted: 1 });
    expect(await again.backfillPass(later, LIVE_P_GONE_Q, 1)).toMatchObject({ ok: true, closed: 1 });
    const cp = diskCheckpoint(dir);
    expect(agentOf(cp, 'agent-z', Q)!.activityId, 'the same id').toBe(listed[0]);
    expect(agentOf(cp, 'agent-z', Q)).toMatchObject({ endBasis: 'backfill-unmeasured' });
    expect(agentOf(cp, 'agent-y', Q), 'Y qualifies now, and the list does not name it').toMatchObject({ executionState: 'active' });
    expect(listOf(dir), 'the re-run does not rewrite the list').toEqual(listed);
  });

  it('B-D9: a list that does not read refuses the dry run and the pass, and nothing is written', async () => {
    const dir = dirWith(journal());
    const d = await applierOver(dir);
    writeFileSync(path.join(dir, DELEGATION_BACKFILL_FILE), 'not json');
    const bytes = checkpointBytes(dir);
    await expect(d.backfillDryRun(NOW, LIVE_P_GONE_Q)).rejects.toThrow(/delegation-backfill\.json/);
    await expect(d.backfillPass(NOW, LIVE_P_GONE_Q, 1)).rejects.toThrow(/delegation-backfill\.json/);
    expect(checkpointBytes(dir).equals(bytes)).toBe(true);
    expect(d.failure(), 'a refused list leaves the applier ready').toBeNull();
  });

  it('B-D10: review 3026 F4: the dry run counts an agent the meta door opened after its final notification was journaled', async () => {
    // W is named by its own tool call (a candidate, no join), its final notification arrives while its key is unmapped (it ends
    // nothing), and only then does a positive meta read open it: it stays open, though the journal holds its task report.
    const records = chain([sessionStart(0), agentToolCall(1000, 'agent-w'), notification(2000, 'agent-w', 'toolu_launch_w')]);
    const dir = dirWith(records);
    const d = await applierOver(dir);
    const opened = await d.applyPositiveAgentMeta({ parentId: P, parentIncarnation: INC, agentId: 'agent-w' });
    expect(opened.kind).toBe('opened');
    expect(agentOf(d.state().checkpoint as DelegationCheckpointV1, 'agent-w')).toMatchObject({ executionState: 'active' });
    expect(await d.backfillDryRun(NOW, new Map([[P, measured(INC)]]))).toMatchObject({ reportedFirst: 1, closes: 0, failedCheck: 1 });
  });
});
