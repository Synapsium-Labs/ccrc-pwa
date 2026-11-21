// Session helpers S1 (D-8830; spec docs/superpowers/specs/2026-11-19-session-helpers-design.md §7.1, Table 9, Table 13's S1 row;
// plan docs/superpowers/plans/2026-11-20-broker-helper-ends.md): an Agent's final task notification, already journaled, ends its
// broker activity record, directly on the natural key (session, incarnation, `agent`, task id) through the mapping, with no launch
// index. `endedAt` is the notification's observed time and `endBasis` is `task-report`. `endBasis` is optional (absence means
// `observed`), and a later measured end replaces a `backfill-unmeasured` one, basis and `endedAt` together.
//
// Against `main` (measured at 66c63606c3) the file's 24 cases are 19 red and 5 green. The green ones are the two CHARACTERIZATION
// PINS (PIN-1, PIN-2), which pin behaviour `main` already has, and three GUARDS that are green there by design, because each pins
// what the arm must leave alone: S1-A4, S1-A6 and S1-C2 (each goes red under its own mutant, listed in the task note). Three red cases
// are red on `main` for a reason other than the missing arm, said at each: S1-W4, S1-C3 and S1-M2. The new module and the new key are
// reached by behaviour only (the builder, recovery, the codec, SQLite), never imported, so each case reds on its own assertion at the
// base. Every file is in a FIXTURE directory: nothing reads or writes the live `~/.ccrc`.
import { afterEach, describe, it, expect } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import type { DelegationEventEnvelopeV1 } from '../../shared/api.js';
import { CoordDbUnmigratable, openCoordDb, tx } from '../src/coord/db.js';
import { COORD_SCHEMA_VERSION, MIGRATIONS } from '../src/coord/schema.js';
import { CoordStore } from '../src/coord/store.js';
import {
  delegationSha256Hex,
  emptyDelegationCheckpoint,
  formatDelegationInstant,
  type DelegationActivityRow,
  type DelegationCheckpointV1,
  type DelegationJournalRecordV1,
} from '../src/coord/delegation-model.js';
import { DELEGATION_JOURNAL_FILE, buildDelegationJournalRecord, encodeDelegationJournalRecord } from '../src/coord/delegation-journal.js';
import {
  DELEGATION_CHECKPOINT_FILE,
  DelegationCheckpointBuilder,
  DelegationCheckpointError,
  assertDelegationCheckpointProjectable,
  decodeDelegationCheckpoint,
  encodeDelegationCheckpoint,
} from '../src/coord/delegation-checkpoint.js';
import { recoverDelegation } from '../src/coord/delegation-recovery.js';
import { DelegationDurability } from '../src/coord/delegation-durability.js';
import type { DelegationProjectionPort } from '../src/coord/delegation-db-projection.js';
import { nodeDelegationFilePort } from '../src/coord/delegation-file-port.js';
import { decideAdoption, type AdoptionInput, type ParentFact } from '../src/coord/delegation-adoption.js';
import { delegationTreeKey } from '../src/coord/delegation-correlation.js';
import { checkpointWithLease, equalCarrier } from './delegationLeaseFixture.js';
import { mkTmp } from './tmpHelpers.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// ── fixtures ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** A row as S1 writes it: the optional basis, read without importing the new type, so the file compiles at the base. */
type Row = DelegationActivityRow & { endBasis?: string };

const PARENT = 'lane-a-demo';
const INC = 'g1';
const CLAUDE = '11111111-2222-3333-4444-555555555555';
const X = 'agent-x1';
const Y = 'agent-y1';
const RUN = 'wf_run1';
const T0 = Date.UTC(2026, 10, 20, 12);
/** Event time `n` seconds after T0; every record is accepted one second after its event (journal time, no clock read). */
const T = (n: number): string => formatDelegationInstant(T0 + n * 1000);
type Over = { sessionId?: string; parentIncarnation?: string };
type Ev = DelegationEventEnvelopeV1;
type Status = 'completed' | 'failed' | 'cancelled' | 'unknown';

const base = (n: number, over: Over = {}) => ({
  v: 1 as const, observedAt: T(n), sessionId: over.sessionId ?? PARENT, parentIncarnation: over.parentIncarnation ?? INC, claudeSessionId: CLAUDE,
  eventId: delegationSha256Hex(`s1-event-${n}-${over.sessionId ?? PARENT}-${over.parentIncarnation ?? INC}`), bucket: '2026112012',
  startOffset: n * 100, endOffset: n * 100 + 99,
});
const sessionStart = (n: number, over: Over = {}): Ev => ({ ...base(n, over), eventKind: 'SessionStart', source: 'startup' });
const subagentStart = (n: number, agentId: string, over: Over = {}, agentType: string | null = null): Ev =>
  ({ ...base(n, over), eventKind: 'SubagentStart', agentId, agentType });
const subagentStop = (n: number, agentId: string, over: Over = {}, agentType: string | null = null): Ev =>
  ({ ...base(n, over), eventKind: 'SubagentStop', agentId, agentType, agentTranscriptPath: null });
const agentLaunch = (n: number, agentId: string, status: 'async-launched' | 'completed' = 'async-launched'): Ev =>
  ({ ...base(n), eventKind: 'PostToolUse', toolName: 'Agent', toolUseId: `toolu_a${n}`, outcome: status, launch: { status, agentId, isAsync: status === 'async-launched' } });
/** A task notification as the hook journals it: the task id of an Agent is its agent id (spec Table 1, 105 of 105 captures). */
const notification = (n: number, taskId: string, status: Status = 'completed', toolUseId = `toolu_n${n}`, over: Over = {}): Ev =>
  ({ ...base(n, over), eventKind: 'UserPromptSubmit', notification: { taskId, toolUseId, status } });
const workflowLaunch = (n: number, runId: string): Ev =>
  ({ ...base(n), eventKind: 'PostToolUse', toolName: 'Workflow', toolUseId: `toolu_${n}`, outcome: 'async-launched',
    launch: { status: 'async-launched', taskId: 'task_1', taskType: 'local_workflow', workflowName: 'review-pass', runId, transcriptDir: `transcripts/${runId}`, scriptPath: 'scripts/review-pass.js' } });

/** The chain of evidence records for `events`, from `first`, each accepted one second after its own event. */
function chain(events: readonly Ev[], first = 1, previous: string | null = null): DelegationJournalRecordV1[] {
  const out: DelegationJournalRecordV1[] = [];
  let prev = previous;
  events.forEach((event, i) => {
    const acceptedAt = formatDelegationInstant(Date.parse(event.observedAt) + 1000);
    const r = buildDelegationJournalRecord({ sequence: first + i, acceptedAt, previousDigest: prev, entry: { kind: 'evidence-accepted', event } });
    out.push(r);
    prev = r.digest;
  });
  return out;
}
const recover = (records: readonly DelegationJournalRecordV1[], cp: DelegationCheckpointV1 | null = null) => {
  const report = recoverDelegation(cp === null ? null : encodeDelegationCheckpoint({ ...cp, revision: Math.max(1, cp.revision) }), records);
  expect(report.failure, 'recovery is ready').toBeNull();
  return report;
};
/** The builder that folded `records` live, one by one, from an empty checkpoint: the applier's own path. */
function liveFold(records: readonly DelegationJournalRecordV1[]): DelegationCheckpointBuilder {
  const b = DelegationCheckpointBuilder.from(emptyDelegationCheckpoint());
  for (const r of records) b.foldRecord(r);
  return b;
}
const agentRow = (cp: DelegationCheckpointV1, agentId: string, over: Over = {}): Row | undefined =>
  cp.activities.find((a) => a.sourceKind === 'agent' && a.upstreamId === agentId && a.parentId === (over.sessionId ?? PARENT)
    && a.parentIncarnation === (over.parentIncarnation ?? INC)) as Row | undefined;
const wfRow = (cp: DelegationCheckpointV1, upstreamId: string): Row | undefined =>
  cp.activities.find((a) => a.sourceKind === 'workflow' && a.upstreamId === upstreamId) as Row | undefined;
/** `cp` with the rows `pick` names replaced by `edit(row)`; the mapping is left as it is. */
const editRows = (cp: DelegationCheckpointV1, pick: (a: Row) => boolean, edit: (a: Row) => Row): DelegationCheckpointV1 =>
  ({ ...cp, activities: cp.activities.map((a) => (pick(a as Row) ? edit(a as Row) : a)) });
/** A record as a checkpoint built before S1 holds it: open, no end. */
const reopened = (a: Row): Row => { const { endBasis: _b, ...rest } = a; return { ...rest, executionState: 'active', endedAt: null }; };
/** A record as S2's pass would leave it (the fixture writes it by hand: S2 is not built): closed, no end time, `backfill-unmeasured`. */
const backfilled = (a: Row): Row => ({ ...a, executionState: 'ended', endedAt: null, endBasis: 'backfill-unmeasured' });
const failureCode = (fn: () => unknown): string => {
  try { fn(); } catch (err) { if (err instanceof DelegationCheckpointError) return err.code; throw err; }
  return 'accepted';
};

// ── the arm ──────────────────────────────────────────────────────────────────────────────────────────────────────────

describe('S1: an Agent\'s final task notification ends its record (spec §7.1)', () => {
  it('S1-A1: a SubagentStart opens X; its completed notification ends X at the notification\'s time, basis task-report', () => {
    const records = chain([sessionStart(1), subagentStart(2, X), notification(5, X)]);
    const x = agentRow(liveFold(records).build(1), X);
    expect(x, 'X is open from its SubagentStart').toBeDefined();
    expect(x).toMatchObject({ executionState: 'ended', endedAt: T(5), lastEventAt: T(5), endBasis: 'task-report' });
  });

  it('S1-A2: failed and cancelled are final too; unknown is not, and leaves the record exactly as it was', () => {
    for (const status of ['failed', 'cancelled'] as const) {
      const x = agentRow(liveFold(chain([sessionStart(1), subagentStart(2, X), notification(5, X, status)])).build(1), X);
      expect(x, status).toMatchObject({ executionState: 'ended', endedAt: T(5), endBasis: 'task-report' });
    }
    const before = agentRow(liveFold(chain([sessionStart(1), subagentStart(2, X)])).build(1), X);
    const after = agentRow(liveFold(chain([sessionStart(1), subagentStart(2, X), notification(5, X, 'unknown')])).build(1), X);
    expect(after, 'an unknown status is not a final report: nothing moves, not even lastEventAt').toEqual(before);
    expect(after).not.toHaveProperty('endBasis');
  });

  it('S1-A3: the join is the natural key, with no launch index: a launch-opened agent ends whatever tool-use id the notification carries', () => {
    const x = agentRow(liveFold(chain([sessionStart(1), agentLaunch(2, X), notification(5, X, 'completed', 'toolu_other')])).build(1), X);
    expect(x).toMatchObject({ executionState: 'ended', endedAt: T(5), endBasis: 'task-report' });
  });

  // GUARD, green on main by design: no other key ends anything (red under EB11, the key without its incarnation).
  it('S1-A4: the key is the whole natural key: another session or incarnation, or an unmapped agent id, ends nothing and refuses nothing', () => {
    const other = { sessionId: 'lane-b-demo' };
    const otherInc = { parentIncarnation: 'g2' };
    const records = chain([sessionStart(1), subagentStart(2, X), sessionStart(3, other), sessionStart(4, otherInc),
      notification(5, X, 'completed', 'toolu_1', other), notification(6, X, 'completed', 'toolu_2', otherInc), notification(7, 'agent-nobody')]);
    const cp = liveFold(records).build(1);
    expect(agentRow(cp, X), 'X stays open: no notification named its own key').toMatchObject({ executionState: 'active', endedAt: null });
    expect(agentRow(cp, X)).not.toHaveProperty('endBasis');
    expect(cp.activities.map((a) => a.upstreamId), 'no record is opened by a notification').toEqual([X]);
  });

  it('S1-A5: a record a measured end already ended keeps that end: a Stop then the notification stays observed (the measured order, F3)', () => {
    const x = agentRow(liveFold(chain([sessionStart(1), subagentStart(2, X), subagentStop(3, X), notification(5, X)])).build(1), X);
    expect(x).toMatchObject({ executionState: 'ended', endedAt: T(3), lastEventAt: T(3) });
    expect(x, 'absence means observed: a row ended today reads as it did').not.toHaveProperty('endBasis');
    const y = agentRow(liveFold(chain([sessionStart(1), subagentStart(2, Y), notification(4, Y), subagentStop(6, Y)])).build(1), Y);
    expect(y, 'the notification first: the later Stop does not move a task-report end').toMatchObject({ endedAt: T(4), endBasis: 'task-report', lastEventAt: T(6) });
  });

  // GUARD, green on main by design: a Workflow's own notification ends its run as before (red under EB4).
  it('S1-A6: a Workflow\'s own notification still ends its run as before, and an agent of the same session is untouched by it', () => {
    const cp = liveFold(chain([sessionStart(1), workflowLaunch(2, RUN), subagentStart(3, X), notification(5, 'task_1', 'completed', 'toolu_2')])).build(1);
    expect(wfRow(cp, RUN)).toMatchObject({ executionState: 'ended', endedAt: T(5) });
    expect(wfRow(cp, RUN), 'the run ends observed, as today').not.toHaveProperty('endBasis');
    expect(agentRow(cp, X)).toMatchObject({ executionState: 'active', endedAt: null });
  });

  it('S1-A7: out-of-order event times: the end is never before the record opened, and lastEventAt never moves back', () => {
    // X opens at 5 (its launch), a tool event inside it is seen at 9, and its notification, journaled last, was observed at 3.
    const toolInX: Ev = { ...base(9), eventKind: 'PostToolUse', toolName: 'Bash', toolUseId: 'toolu_x9', outcome: 'completed', agentId: X };
    const x = agentRow(liveFold(chain([sessionStart(1), agentLaunch(5, X), toolInX, notification(3, X)])).build(1), X);
    expect(x).toMatchObject({ executionState: 'ended', openedAt: T(5), endedAt: T(5), lastEventAt: T(9), endBasis: 'task-report' });
  });

  it('S1-R1: a record retired behind the cut before its notification arrives: the fold does not refuse, opens nothing, and the open sibling still ends', () => {
    const records = chain([sessionStart(1), subagentStart(2, X), subagentStop(3, X), subagentStart(4, Y)]);
    const b = liveFold(records);
    const xId = agentRow(b.build(1), X)!.activityId;
    expect(b.retireBehindCut([xId]), 'X (ended, unnamed) is retired').toBe(1);
    const late = chain([notification(6, X), notification(7, Y)], records.length + 1, records[records.length - 1]!.digest);
    for (const r of late) expect(() => b.foldRecord(r), `record ${r.sequence} folds`).not.toThrow();
    const cp = b.build(1);
    expect(agentRow(cp, X), 'the retired record stays retired').toBeUndefined();
    expect(Object.keys(cp.activityIdsByNaturalKey).some((k) => k.includes(X)), 'and unmapped').toBe(false);
    expect(agentRow(cp, Y)).toMatchObject({ executionState: 'ended', endedAt: T(7), endBasis: 'task-report' });
  });
});

// ── boot, replay, rebuild ─────────────────────────────────────────────────────────────────────────────────────────────

describe('S1: the first boot and the rebuild (spec §7.1, "Two effects at S1\'s first boot")', () => {
  const world = () => chain([sessionStart(1), subagentStart(2, X), subagentStart(3, Y), notification(5, X), notification(6, Y, 'cancelled')]);

  it('S1-B1: boot replay: a checkpoint built before S1 covers an open X whose notification the journal retains; recovery ends it, replays nothing, counts it', () => {
    const records = world();
    const tip = liveFold(records).build(1);
    const before = editRows(tip, (a) => a.sourceKind === 'agent', reopened);
    expect([agentRow(before, X)?.executionState, agentRow(before, Y)?.executionState], 'the premise: open before S1').toEqual(['active', 'active']);
    const report = recover(records, before);
    expect(report.replayed, 'every record is covered').toBe(0);
    expect(report.coveredEnds, 'the two covered notifications each ended a record').toBe(2);
    expect(agentRow(report.state.checkpoint, X)).toMatchObject({ executionState: 'ended', endedAt: T(5), endBasis: 'task-report' });
    expect(agentRow(report.state.checkpoint, Y)).toMatchObject({ executionState: 'ended', endedAt: T(6), endBasis: 'task-report' });
  });

  it('S1-B2: the rebuild gives the same ends: from no checkpoint, from one before the notifications, and the live fold agree row for row', () => {
    const records = world();
    const live = liveFold(records).build(1);
    const fromNothing = recover(records).state.checkpoint;
    const fromMiddle = recover(records, recover(records.slice(0, 3)).state.checkpoint).state.checkpoint;
    for (const cp of [fromNothing, fromMiddle]) {
      expect(cp.activities, 'activity rows equal the live fold\'s').toEqual(live.activities);
      expect(cp.activityIdsByNaturalKey).toEqual(live.activityIdsByNaturalKey);
    }
    expect(agentRow(live, X)).toMatchObject({ endBasis: 'task-report' });
  });

  it('S1-B3: the applier saves what the first boot ended: the disk checkpoint, SQLite\'s endBasis column and one warn line', async () => {
    // W starts and never ends: a row whose endBasis column is NULL, read back as no key.
    const W = 'agent-w1';
    const records = chain([sessionStart(1), subagentStart(2, X), subagentStart(3, Y), notification(5, X), notification(6, Y, 'cancelled'), subagentStart(7, W)]);
    const before = editRows(liveFold(records).build(1), (a) => a.sourceKind === 'agent', reopened);
    const dir = mkTmp('ccrc-s1-boot-');
    writeFileSync(path.join(dir, DELEGATION_JOURNAL_FILE), Buffer.concat(records.map((r) => Buffer.from(encodeDelegationJournalRecord(r)))));
    writeFileSync(path.join(dir, DELEGATION_CHECKPOINT_FILE), encodeDelegationCheckpoint({ ...before, revision: 1 }));
    const store = new CoordStore(openCoordDb(path.join(dir, 'coord.db')));
    const lines: string[] = [];
    const dur = track(await DelegationDurability.open({ dir, projection: portOf(store), now: () => T0 + 3_600_000, randomUUID: () => 'unused',
      port: nodeDelegationFilePort, warn: (m) => { lines.push(m); } }));
    expect(dur.failure(), 'the applier is ready').toBeNull();
    const disk = decodeDelegationCheckpoint(new Uint8Array(readFileSync(path.join(dir, DELEGATION_CHECKPOINT_FILE))));
    expect([agentRow(disk, X)?.endBasis, agentRow(disk, Y)?.endBasis], 'the disk checkpoint').toEqual(['task-report', 'task-report']);
    const db = store.db.prepare("SELECT upstreamId, executionState, endBasis FROM delegation_activities WHERE sourceKind = 'agent' ORDER BY upstreamId").all();
    expect(db, 'SQLite').toEqual([{ upstreamId: W, executionState: 'active', endBasis: null },
      { upstreamId: X, executionState: 'ended', endBasis: 'task-report' }, { upstreamId: Y, executionState: 'ended', endBasis: 'task-report' }]);
    const projected = store.readDelegationProjection().activities;
    expect([agentRow({ ...disk, activities: projected }, X)?.endBasis, agentRow({ ...disk, activities: projected }, Y)?.endBasis], 'the projection reads it back')
      .toEqual(['task-report', 'task-report']);
    expect(agentRow({ ...disk, activities: projected }, W), 'a NULL column reads back as no key').not.toHaveProperty('endBasis');
    expect(projected, 'every projected row reads back as its checkpoint row, field for field').toEqual(disk.activities);
    expect(lines.filter((l) => l.includes('delegation recovery changed 2 activity row(s) from covered task notifications')), 'one warn line').toHaveLength(1);
  });
});

// ── the adoption effect ──────────────────────────────────────────────────────────────────────────────────────────────

describe('S1: the adoption effect (spec §7.1, delegation-adoption.ts#terminalOf)', () => {
  it('S1-D1: an isolation-worktree lease whose agent\'s task report arrives takes that report\'s time as its terminal time, under a live parent', () => {
    const records = chain([sessionStart(1), subagentStart(2, X), notification(9, X)]);
    const open = agentRow(liveFold(records.slice(0, 2)).build(1), X)!;
    const ended = agentRow(liveFold(records).build(1), X)!;
    const decide = (activity: Row) => {
      const cp0 = checkpointWithLease({ generation: 1, sourceKind: 'agent', carrierGenerationSeen: 1, activityId: activity.activityId });
      const cp: DelegationCheckpointV1 = { ...cp0, activities: [activity] };
      const l = cp.leases[0]!;
      const parent: ParentFact = { registry: 'present', incarnation: l.parentIncarnation, deadSince: null, ccd: true, alive: true, retractedAt: null, lastAlive: [] };
      const input: AdoptionInput = {
        now: T(10), checkpoint: cp, carriers: new Map([[l.leaseId, equalCarrier(l)]]), treePresent: new Set([delegationTreeKey(l.project, l.adminRecord)]),
        censused: new Set([l.project]), audits: new Map(), watch: new Map(), parents: new Map([[l.parentId, parent]]), conflicting: new Set<string>(),
        boxHolds: true, breaker: 'clear', marker: 'present',
      };
      return decideAdoption(input).watch.get(l.leaseId);
    };
    expect(decide(open), 'an open record under a live parent is no terminal evidence').toBeUndefined();
    expect(decide(ended), 'the task report\'s time is the lease\'s terminal time').toEqual({ generation: 1, terminalAt: T(9), passes: 1 });
  });
});

// ── the basis: codec, assertion, the widened "not ended" ─────────────────────────────────────────────────────────────

describe('S1: endBasis in the checkpoint (spec Table 9)', () => {
  const ended = () => liveFold(chain([sessionStart(1), subagentStart(2, X), notification(5, X)])).build(1);

  it('S1-C1: the codec carries endBasis byte for byte, and a row without it decodes without it', () => {
    const cp = ended();
    const back = decodeDelegationCheckpoint(encodeDelegationCheckpoint(cp));
    expect(agentRow(back, X)?.endBasis).toBe('task-report');
    expect(encodeDelegationCheckpoint(back)).toEqual(encodeDelegationCheckpoint(cp));
    const plain = liveFold(chain([sessionStart(1), subagentStart(2, X), subagentStop(3, X)])).build(1);
    expect(agentRow(decodeDelegationCheckpoint(encodeDelegationCheckpoint(plain)), X)).not.toHaveProperty('endBasis');
    const observed = editRows(plain, () => true, (a) => ({ ...a, endBasis: 'observed' }));
    expect(agentRow(decodeDelegationCheckpoint(encodeDelegationCheckpoint(observed)), X)?.endBasis, 'observed, written out, reads back').toBe('observed');
  });

  // GUARD, green on main by design: the closed codec refuses a word outside the three (red under CP2, any string accepted).
  it('S1-C2: the codec refuses a basis outside the three words', () => {
    const bad = editRows(ended(), () => true, (a) => ({ ...a, endBasis: 'guessed' } as unknown as Row));
    expect(failureCode(() => decodeDelegationCheckpoint(encodeDelegationCheckpoint(bad)))).toBe('bad-shape');
  });

  // Red on main because main has no projectability rule for the key (its first refusal is accepted there); its fixture row is not
  // ended by a task report on main either, since main has no arm.
  it('S1-C3: the projectability rule binds rows that carry the key only: task-report needs an endedAt, backfill-unmeasured a null one', () => {
    const cp = ended();
    expect(failureCode(() => assertDelegationCheckpointProjectable(cp)), 'the arm\'s own row').toBe('accepted');
    const noEnd = editRows(cp, () => true, (a) => ({ ...a, endedAt: null }));
    expect(failureCode(() => assertDelegationCheckpointProjectable(noEnd)), 'task-report with no endedAt').toBe('unprojectable');
    const backfillWithEnd = editRows(cp, () => true, (a) => ({ ...a, endBasis: 'backfill-unmeasured' }));
    expect(failureCode(() => assertDelegationCheckpointProjectable(backfillWithEnd)), 'backfill with an endedAt').toBe('unprojectable');
    const backfill = editRows(cp, () => true, backfilled);
    expect(failureCode(() => assertDelegationCheckpointProjectable(backfill)), 'backfill with a null endedAt').toBe('accepted');
    const keyless = editRows(cp, () => true, (a) => { const { endBasis: _b, ...rest } = a; return { ...rest, endedAt: null }; });
    expect(failureCode(() => assertDelegationCheckpointProjectable(keyless)), 'a row without the key is not touched').toBe('accepted');
  });
});

describe('S1: a later measured end replaces a backfill one, basis and endedAt together (the widened "not ended")', () => {
  /** `records`' first `upTo` folded, the picked rows backfilled by hand, then the rest folded live onto that checkpoint. */
  function afterBackfill(records: readonly DelegationJournalRecordV1[], upTo: number, pick: (a: Row) => boolean): DelegationCheckpointV1 {
    const head = recover(records.slice(0, upTo)).state.checkpoint;
    const b = DelegationCheckpointBuilder.from(editRows(head, pick, backfilled));
    for (const r of records.slice(upTo)) b.foldRecord(r);
    return b.build(2);
  }

  it('S1-W1 (touchActivity): a SubagentStop after the backfill ends X observed: endedAt is the Stop\'s time and the basis key is gone', () => {
    const x = agentRow(afterBackfill(chain([sessionStart(1), subagentStart(2, X), subagentStop(8, X)]), 2, (a) => a.upstreamId === X), X);
    expect(x).toMatchObject({ executionState: 'ended', endedAt: T(8), lastEventAt: T(8) });
    expect(x).not.toHaveProperty('endBasis');
  });

  it('S1-W2 (the task-report arm): a task report after the backfill ends X task-report at the report\'s time', () => {
    const x = agentRow(afterBackfill(chain([sessionStart(1), subagentStart(2, X), notification(8, X)]), 2, (a) => a.upstreamId === X), X);
    expect(x).toMatchObject({ executionState: 'ended', endedAt: T(8), endBasis: 'task-report' });
  });

  it('S1-W3 (the run and worker arms): a Workflow notification after the backfill ends the run and its worker observed', () => {
    const records = chain([sessionStart(1), workflowLaunch(2, RUN), notification(8, 'task_1', 'completed', 'toolu_2')]);
    const head = recover(records.slice(0, 2));
    expect(head.facts!.builder.openWorkflowWorkerFromMeta(PARENT, INC, RUN, 0).kind).toBe('opened');
    const b = DelegationCheckpointBuilder.from(editRows(head.facts!.builder.build(1), (a) => a.sourceKind === 'workflow', backfilled));
    // the launch index is journal-derived builder state: the covered launch is observed again, as recovery does
    b.observeRecord(records[0]!); b.observeRecord(records[1]!);
    b.foldRecord(records[2]!);
    const cp = b.build(2);
    for (const id of [RUN, `${RUN}-0`]) {
      expect(wfRow(cp, id), id).toMatchObject({ executionState: 'ended', endedAt: T(8) });
      expect(wfRow(cp, id), `${id}: observed, the basis key gone`).not.toHaveProperty('endBasis');
    }
  });

  // Red on main for its fixture, not its arm: main's closed reader refuses the hand-written `endBasis` key, so recovery fails
  // before the replay runs.
  it('S1-W4: a backfill row the boot replay meets: its covered task report replaces it and counts as a covered end', () => {
    const records = chain([sessionStart(1), subagentStart(2, X), notification(5, X)]);
    const stale = editRows(liveFold(records).build(1), (a) => a.upstreamId === X, backfilled);
    const report = recover(records, stale);
    expect(report.coveredEnds).toBe(1);
    expect(agentRow(report.state.checkpoint, X)).toMatchObject({ executionState: 'ended', endedAt: T(5), endBasis: 'task-report' });
  });
});

// ── the projection and the migration ───────────────────────────────────────────────────────────────────────────────

/** The entry that adds `delegation_activities.endBasis`, found by its DDL, so a renumber at landing moves nothing here. */
const SLOT = MIGRATIONS.findIndex((m) => /ALTER TABLE delegation_activities ADD COLUMN endBasis/.test(m)) + 1;
const dbPathIn = (home: string): string => path.join(home, '.ccrc', 'coord.db');
/** A coord.db built through every entry before SLOT, with one session and one ended activity row (no basis: there is no column yet). */
function databaseBeforeSlot(extra = ''): string {
  const p = dbPathIn(mkTmp('ccrc-s1-mig-'));
  mkdirSync(path.dirname(p), { recursive: true });
  const raw = new DatabaseSync(p);
  tx(raw, () => {
    for (let v = 0; v < SLOT - 1; v++) raw.exec(MIGRATIONS[v]!);
    raw.exec(`PRAGMA user_version = ${SLOT - 1}`);
    raw.exec(`INSERT INTO delegation_sessions (sessionId, parentIncarnation, explicitIntentAt, effective, effectiveBasisJson, claudeSessionIdsJson, firstObservedAt, lastObservedAt)
      VALUES ('${PARENT}', '${INC}', NULL, 0, '[]', '[]', 1, 1)`);
    raw.exec(`INSERT INTO delegation_activities (activityId, parentId, parentIncarnation, sourceKind, upstreamId, identityJournalId, displayName, executionState, openedAt, endedAt, lastEventAt)
      VALUES ('${'a'.repeat(64)}', '${PARENT}', '${INC}', 'agent', '${X}', '${'b'.repeat(64)}', NULL, 'ended', 1, 2, 2)`);
    if (extra !== '') raw.exec(extra);
  });
  raw.close();
  return p;
}

describe('S1: the endBasis column (spec Table 9, the projection row)', () => {
  it('S1-M1: a database at the previous version gains the nullable column, null on the old row; the CHECK refuses a word outside the three and an end that contradicts its basis', () => {
    expect(SLOT, 'a MIGRATIONS entry adds delegation_activities.endBasis').toBeGreaterThan(0);
    const db = openCoordDb(databaseBeforeSlot());
    try {
      expect(db.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: COORD_SCHEMA_VERSION });
      expect(db.prepare('SELECT upstreamId, endBasis FROM delegation_activities').all()).toEqual([{ upstreamId: X, endBasis: null }]);
      const set = (basis: string, endedAt: string): (() => unknown) => () => db.prepare(`UPDATE delegation_activities SET endBasis = '${basis}', endedAt = ${endedAt}`).run();
      expect(set('guessed', '2'), 'a word outside the three').toThrow(/CHECK/);
      expect(set('task-report', 'NULL'), 'task-report needs an endedAt').toThrow(/CHECK/);
      expect(set('backfill-unmeasured', '2'), 'backfill-unmeasured needs a null endedAt').toThrow(/CHECK/);
      expect(set('task-report', '2')).not.toThrow();
      expect(set('backfill-unmeasured', 'NULL')).not.toThrow();
      expect(set('observed', '2')).not.toThrow();
    } finally {
      db.close();
    }
  });

  // Red on main only because main has no endBasis entry for SLOT to find: the refusal it then asserts (a failing migration keeps
  // the file's version and rows) is behaviour main already has for every migration.
  it('S1-M2: a migration that cannot apply refuses to start rather than open empty: the file keeps its version and its row', () => {
    expect(SLOT, 'a MIGRATIONS entry adds delegation_activities.endBasis').toBeGreaterThan(0);
    // A file that already carries a column of that name (a hand edit): the ALTER fails, so the open must refuse, not start empty.
    const p = databaseBeforeSlot('ALTER TABLE delegation_activities ADD COLUMN endBasis TEXT');
    expect(() => openCoordDb(p)).toThrow(CoordDbUnmigratable);
    const raw = new DatabaseSync(p, { readOnly: true });
    try {
      expect(raw.prepare('PRAGMA user_version').get(), 'never written forward past a failed step').toMatchObject({ user_version: SLOT - 1 });
      expect(raw.prepare('SELECT upstreamId FROM delegation_activities').all(), 'and its rows are still there').toEqual([{ upstreamId: X }]);
    } finally {
      raw.close();
    }
  });
});

describe('S1: which checkpoints an older server can read (spec Table 13, the rollback)', () => {
  it('S1-K1: against a frozen copy of main\'s activity key list, a row a task report ended carries exactly endBasis outside it, and a checkpoint whose ends are all observed carries no key outside it', () => {
    // The activity keys `readActivity` closes over at main d0b7467b9, copied here and never derived, so a widening shows up as a red.
    const MAIN_ACTIVITY_KEYS = ['activityId', 'parentId', 'parentIncarnation', 'sourceKind', 'upstreamId', 'identityJournalId', 'displayName',
      'executionState', 'openedAt', 'endedAt', 'lastEventAt'];
    const outside = (cp: DelegationCheckpointV1): string[] =>
      [...new Set(cp.activities.flatMap((a) => Object.keys(a)).filter((k) => !MAIN_ACTIVITY_KEYS.includes(k)))].sort();
    const reported = liveFold(chain([sessionStart(1), subagentStart(2, X), notification(5, X)])).build(1);
    expect(agentRow(reported, X), 'X is ended by its task report').toMatchObject({ executionState: 'ended', endBasis: 'task-report' });
    expect(outside(reported), 'the keys outside main\'s list, on a row a task report ended').toEqual(['endBasis']);
    // Every end here is measured: X's own Stop, and Y's Stop before its notification (A5's order). An older server reads this one.
    const observed = liveFold(chain([sessionStart(1), subagentStart(2, X), subagentStop(3, X), subagentStart(4, Y), subagentStop(5, Y),
      notification(6, Y)])).build(1);
    expect([agentRow(observed, X)?.executionState, agentRow(observed, Y)?.executionState], 'both records are ended').toEqual(['ended', 'ended']);
    expect(outside(observed), 'no key outside main\'s list when every end is observed').toEqual([]);
  });
});

// ── characterization pins (green on main; labelled, never counted as reds) ───────────────────────────────────────────

describe('S1 characterization pins', () => {
  it('PIN-1: a captured workflow\'s SubagentStart and SubagentStop give an ended `agent` record (fixtures/delegation/2.1.319/wf-plain.json)', () => {
    // The capture's own payloads, mapped as the session hook maps them (`agent_id` to `agentId`, `agent_type` to `agentType`): no test
    // was found to assert that the broker ends a workflow agent's record on its own Stop (spec §2.2, review 2861 F1).
    type Captured = { seq: number; event: string; payload: { agent_id?: string; agent_type?: string } };
    const capture = JSON.parse(readFileSync(path.join(HERE, 'fixtures/delegation/2.1.319/wf-plain.json'), 'utf8')) as { events: Captured[] };
    const subagent = capture.events.filter((e) => e.event === 'SubagentStart' || e.event === 'SubagentStop');
    expect(subagent.map((e) => [e.event, e.payload.agent_type]), 'the capture holds two workflow agents, started then stopped').toEqual([
      ['SubagentStart', 'workflow-subagent'], ['SubagentStart', 'workflow-subagent'], ['SubagentStop', 'workflow-subagent'], ['SubagentStop', 'workflow-subagent']]);
    const events = [sessionStart(1), ...subagent.map((e) => (e.event === 'SubagentStart'
      ? subagentStart(e.seq + 1, e.payload.agent_id!, {}, e.payload.agent_type!) : subagentStop(e.seq + 1, e.payload.agent_id!, {}, e.payload.agent_type!)))];
    const cp = recover(chain(events)).state.checkpoint;
    const ids = [...new Set(subagent.map((e) => e.payload.agent_id!))];
    expect(ids).toHaveLength(2);
    for (const id of ids) {
      const stop = subagent.find((e) => e.event === 'SubagentStop' && e.payload.agent_id === id)!;
      expect(agentRow(cp, id), id).toMatchObject({ sourceKind: 'agent', executionState: 'ended', endedAt: T(stop.seq + 1) });
    }
  });

  it('PIN-2: a closed reader refuses an unknown activity key with bad-shape, and recovery reports that rather than open empty (the refusal an older server gives S1\'s checkpoint)', () => {
    const records = chain([sessionStart(1), subagentStart(2, X), notification(5, X)]);
    // A checkpoint whose one activity carries a key outside the list the reader knows: the shape of what an older server meets
    // once some row carries `endBasis` (S1-K1 shows which rows do). The key is hand-written, so the pin is green on main too.
    const tip = editRows(liveFold(records).build(1), () => true, (a) => ({ ...a, zzUnknownKey: 'x' } as Row));
    const bytes = encodeDelegationCheckpoint({ ...tip, revision: 1 });
    expect(failureCode(() => decodeDelegationCheckpoint(bytes))).toBe('bad-shape');
    const report = recoverDelegation(bytes, records);
    expect(report.failure, 'recovery reports the refusal').toMatchObject({ code: 'bad-shape' });
    expect(report.failure?.detail).toContain('activity has the unknown key "zzUnknownKey"');
    expect(report.state.checkpoint.activities, 'and opens nothing in its place').toEqual([]);
  });
});

// ── the applier's projection port, and cleanup ──────────────────────────────────────────────────────────────────────

const opened: DelegationDurability[] = [];
const track = (d: DelegationDurability): DelegationDurability => { opened.push(d); return d; };
afterEach(async () => { await Promise.all(opened.splice(0).map((d) => d.close().catch(() => undefined))); });
function portOf(store: CoordStore): DelegationProjectionPort {
  return {
    project: (cp) => store.projectDelegationCheckpoint(cp),
    projectChanged: (prior, next) => store.projectDelegationCheckpointChanges(prior, next),
    insertEvents: (rows) => store.insertDelegationEvents(rows),
    eventStats: () => store.delegationEventStats(),
    countEventsAtOrBelow: (s) => store.countDelegationEventsAtOrBelow(s),
    deleteEventsBetween: (a, b, n) => store.deleteDelegationEventsBetween(a, b, n),
  };
}
