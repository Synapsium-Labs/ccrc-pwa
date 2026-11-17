// D-8182 (Linear hierarchy plan, Task 3.3): the plan sync's moves (§5.3) and closes (§5.4). Two layers: the pure deciders over a
// snapshot (a row each), and the pass over a real coord.db with Linear faked at the `call` port. Neutral names only.
import { afterEach, describe, expect, it } from 'vitest';
import { rmSync } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { CoordStore } from '../src/coord/store.js';
import {
  NO_PLAN_CHANGES, applyPlanChanges, planStorePort, type BindingRow, type CheckpointRow, type EpicRow, type NewTicket, type PlanChanges,
  type PlanStorePort, type StoredPlan, type TicketRow,
} from '../src/coord/planStore.js';
import { planViewOf } from '../src/coord/planRoutes.js';
import type { CcrcOpAsk, CcrcOpOutcome } from '../src/linear/ccrcCall.js';
import type { LinearDirectoryEntries } from '../src/linear/ops.js';
import { PLAN_SYNC_DEBOUNCE_MS, PlanSync } from '../src/linear/planSync.js';
import { planSyncSteps, requestIdOf, type ProgrammeSnapshot, type SyncSnapshot, type SyncStep } from '../src/linear/planSyncPolicy.js';
import { readLinearStore } from '../src/linear/store.js';
import { memCoordDb } from './linearServicesFake.js';
import { seedSlot, WS } from './linearProxyRig.js';
import { mkTmp } from './tmpHelpers.js';

const U = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = 1_800_000_000_000;

// ═══ Layer 1: the deciders ═══

const WSID = 'ws-a';
const epic = (o: Partial<EpicRow> = {}): EpicRow => ({
  id: 1, program: 'prog', project: 'proj-a', waves: [1], key: 'e1', ordinal: 0, title: 'Epic one', summary: 'The summary', state: 'active',
  droppedWhy: null, putBackAt: null, openedAt: null, doneAt: null, ...o,
});
const cp = (o: Partial<CheckpointRow> = {}): CheckpointRow => ({
  id: 1, epicId: 1, key: 'c1', ordinal: 3, title: 'Checkpoint one', kind: 'acceptance', proves: [], state: 'open', droppedWhy: null,
  putBackAt: null, metAt: null, evidence: null, itemId: null, ...o,
});
const tk = (o: Partial<TicketRow> = {}): TicketRow => ({
  id: 1, program: 'prog', project: 'proj-a', epicId: 1, checkpointId: null, key: 't1', kind: 'work', title: 'Ticket one', body: 'Do the thing',
  source: 'plan', state: 'open', runId: null, droppedWhy: null, putBackAt: null, ...o,
});
const directory = {
  viewerId: U(9), labels: [], projects: [], users: [], initiatives: 'on' as const,
  states: ['AAA', 'KEY'].flatMap((teamKey, i) => [
    { id: U(21 + i * 10), name: 'Todo', type: 'unstarted', teamKey }, { id: U(22 + i * 10), name: 'Doing', type: 'started', teamKey },
    { id: U(23 + i * 10), name: 'Done', type: 'completed', teamKey }, { id: U(24 + i * 10), name: 'Nope', type: 'canceled', teamKey }]),
  projectStatuses: [{ id: U(31), name: 'P', type: 'planned' }, { id: U(32), name: 'S', type: 'started' },
    { id: U(33), name: 'C', type: 'completed' }, { id: U(34), name: 'X', type: 'canceled' }],
};
const AAA = { id: U(1), key: 'AAA' };
const KEY = { id: U(3), key: 'KEY' };

function snap(o: { epic?: Partial<EpicRow>; cps?: CheckpointRow[]; tickets?: TicketRow[]; end?: ProgrammeSnapshot['program']['end']; paused?: boolean;
  mode?: 'public' | 'private'; wsInitiatives?: 'on' | 'off' | 'unknown'; teamKey?: string | null; inShort?: string | null; epicIds?: number } = {}): ProgrammeSnapshot {
  const plan: StoredPlan = { program: 'prog', planBy: null, required: true, epics: [{ ...epic(o.epic), checkpoints: o.cps ?? [], tickets: o.tickets ?? [] }] };
  return {
    program: { slug: 'prog', rowid: 7, title: 'The programme', end: o.end ?? null, inShort: o.inShort === undefined ? 'Short words' : o.inShort,
      doneWhen: [{ text: 'It works', proved: false }], paused: o.paused },
    plan, bindings: [],
    workspaces: [{ workspaceId: WSID, initiatives: o.wsInitiatives ?? 'on', directory, teams: [AAA, KEY] }],
    projects: [{ project: 'proj-a', teamKey: o.teamKey === undefined ? 'AAA' : o.teamKey, workspaceId: WSID, mode: o.mode ?? 'private', initiatives: 'on' },
      { project: 'proj-b', teamKey: 'KEY', workspaceId: WSID, mode: 'private', initiatives: 'on' }],
    privateTrackerKeys: [],
  };
}
/** Apply every create and update the deciders emit as if sent, until nothing is left: the state after a full first sync. */
function settle<S extends SyncSnapshot>(s: S): S {
  let nextId = 100;
  let linear = 500;
  for (let i = 0; i < 14; i += 1) {
    const { steps } = planSyncSteps(s);
    if (steps.every((x) => x.kind === 'skip')) return s;
    for (const st of steps) {
      if (st.kind === 'skip') continue;
      if (st.kind === 'create') {
        s.bindings.push({
          id: nextId++, localKind: st.local.kind, localId: st.local.id, workspaceId: st.workspaceId, teamKey: st.teamKey, linearId: U(linear++),
          identifier: null, fingerprint: st.fingerprint, syncedAt: 1, state: 'bound', failedAt: null, failedWord: null, failedInputs: null,
          driftCount: 0, driftSince: null, heldItemId: null,
        } as BindingRow);
      } else s.bindings.find((b) => b.id === st.bindingId)!.fingerprint = st.fingerprint;
    }
  }
  throw new Error('settle did not converge');
}
/** The steps of the first pass that emits `op`, applying every earlier create as `settle` does. */
function settleUntil(s: SyncSnapshot, op: string): SyncStep[] {
  let linear = 800;
  for (let i = 0; i < 14; i += 1) {
    const { steps } = planSyncSteps(s);
    if (steps.some((x) => x.kind !== 'skip' && x.op === op)) return steps;
    for (const st of steps) {
      if (st.kind !== 'create') continue;
      s.bindings.push({
        id: 300 + i * 10 + s.bindings.length, localKind: st.local.kind, localId: st.local.id, workspaceId: st.workspaceId, teamKey: st.teamKey,
        linearId: U(linear++), identifier: null, fingerprint: st.fingerprint, syncedAt: 1, state: 'bound', failedAt: null, failedWord: null,
        failedInputs: null, driftCount: 0, driftSince: null, heldItemId: null,
      } as BindingRow);
    }
  }
  throw new Error(`no ${op}`);
}
const ep = (s: SyncSnapshot) => s.plan.epics[0]!;
const ops = (steps: SyncStep[]): string[] => steps.map((x) => (x.kind === 'skip' ? `skip:${x.why}` : `${x.kind}:${x.op}`));
const stepOf = (steps: SyncStep[], op: string): Extract<SyncStep, { kind: 'update' | 'create' }> =>
  steps.find((x) => x.kind !== 'skip' && x.kind !== 'link' && x.op === op) as never;
const bindingOf = (s: SyncSnapshot, kind: string, id = 1): BindingRow => s.bindings.find((b) => b.localKind === kind && b.localId === id)!;

describe('moves (design §5.3, one row each)', () => {
  it('a dispatched run: the issue update goes to a started state', () => {
    const s = settle(snap({ cps: [cp()], tickets: [tk({ checkpointId: 1 })] }));
    ep(s).tickets[0]!.state = 'started';
    const { steps } = planSyncSteps(s);
    expect(ops(steps)).toEqual(['update:issueUpdate']);
    expect(steps[0]).toMatchObject({ stateType: 'started', input: { stateId: U(22) } });
  });

  it('a closed run: the issue update goes to a completed state', () => {
    const s = settle(snap({ tickets: [tk({ state: 'started' })] }));
    ep(s).tickets[0]!.state = 'done';
    expect(planSyncSteps(s).steps[0]).toMatchObject({ kind: 'update', stateType: 'completed', input: { stateId: U(23) } });
  });

  it('a met checkpoint: the milestone description gains the met line and the target date is set', () => {
    const s = settle(snap({ cps: [cp()] }));
    ep(s).checkpoints[0]!.state = 'met';
    ep(s).checkpoints[0]!.metAt = Date.parse('2026-11-16T10:00:00Z');
    ep(s).checkpoints[0]!.evidence = { pr: 77 };
    const u = stepOf(planSyncSteps(s).steps, 'projectMilestoneUpdate');
    expect(u.input).toMatchObject({ targetDate: '2026-11-16', description: expect.stringContaining('Met on 2026-11-16: PR #77') });
  });

  // D-8700 (milestone-target-date-once-met; spec §6.2 "target date once met", §5.3): the target date is ccrc's only from the
  // day its checkpoint is met. An open checkpoint's create and update leave it out of the input and of the fields list, so a
  // date someone set in Linear survives a rename; a met one sets it and owns it from then on.
  it('D-8700: an open checkpoint renamed sends no target date, in its input or its fields', () => {
    const s = settle(snap({ cps: [cp()] }));
    ep(s).checkpoints[0]!.title = 'Renamed checkpoint';
    const u = stepOf(planSyncSteps(s).steps, 'projectMilestoneUpdate');
    expect(u.input).toMatchObject({ name: 'Renamed checkpoint' });
    expect('targetDate' in u.input).toBe(false);
    expect(u.fields).not.toContain('targetDate');
    const created = stepOf(settleUntil(snap({ cps: [cp()] }), 'projectMilestoneCreate'), 'projectMilestoneCreate');
    expect('targetDate' in created.input).toBe(false);
    expect(created.fields).not.toContain('targetDate');
  });

  it('D-8700: a met checkpoint owns its target date: its update sets it and lists it, and a later rename sends it again', () => {
    const s = settle(snap({ cps: [cp({ state: 'met', metAt: Date.parse('2026-11-16T10:00:00Z'), evidence: { pr: 1 } })] }));
    ep(s).checkpoints[0]!.title = 'Renamed checkpoint';
    const u = stepOf(planSyncSteps(s).steps, 'projectMilestoneUpdate');
    expect(u.input).toMatchObject({ targetDate: '2026-11-16' });
    expect(u.fields).toContain('targetDate');
  });

  it('D-8700: a met checkpoint reopened leaves the target date out again (the met line goes, the date is not cleared)', () => {
    const s = settle(snap({ cps: [cp({ state: 'met', metAt: Date.parse('2026-11-16T10:00:00Z'), evidence: { pr: 1 } })] }));
    ep(s).checkpoints[0]!.state = 'open';
    ep(s).checkpoints[0]!.metAt = null;
    const u = stepOf(planSyncSteps(s).steps, 'projectMilestoneUpdate');
    expect('targetDate' in u.input).toBe(false);
    expect(u.fields).not.toContain('targetDate');
  });

  it('an epic active, then done: the project status moves to started, then completed; a planned epic reads planned', () => {
    const planned = snap({ epic: { state: 'planned' } });
    expect(stepOf(planSyncSteps(planned).steps, 'projectCreate').input['statusId']).toBe(U(31));
    const s = settle(snap({ epic: { state: 'planned' } }));
    ep(s).state = 'active';
    expect(stepOf(planSyncSteps(s).steps, 'projectUpdate').input['statusId']).toBe(U(32));
    const s2 = settle(snap({}));
    ep(s2).state = 'done';
    expect(stepOf(planSyncSteps(s2).steps, 'projectUpdate').input['statusId']).toBe(U(33));
  });

  it('a paused programme: the initiative description notes it and its status is unchanged', () => {
    const s = settle(snap());
    const before = stepOf(planSyncSteps(Object.assign(snap(), { bindings: s.bindings })).steps, 'initiativeUpdate');
    expect(before).toBeUndefined();
    const paused = Object.assign(snap({ paused: true }), { bindings: s.bindings });
    const u = stepOf(planSyncSteps(paused).steps, 'initiativeUpdate');
    expect(u.input['description']).toEqual(expect.stringContaining('Paused'));
    expect(u.input['status']).toBe('Active');
  });

  it('the open status types: an open ticket reads unstarted', () => {
    const c = stepOf(planSyncSteps(settle(snap({ cps: [] }))).steps.concat(
      planSyncSteps(Object.assign(snap({ tickets: [tk()] }), { bindings: settle(snap()).bindings })).steps), 'issueCreate');
    expect(c.input['stateId']).toBe(U(21));
  });

  it('a ticket whose project changes inside the workspace: one issue update with the new team id', () => {
    const s = settle(snap({ tickets: [tk()] }));
    ep(s).tickets[0]!.project = 'proj-b';
    const { steps } = planSyncSteps(s);
    expect(ops(steps)).toEqual(['update:projectUpdate', 'update:issueUpdate']);     // the project's teams widen too (C14)
    expect(stepOf(steps, 'issueUpdate')).toMatchObject({ teamKey: 'KEY', input: { teamId: KEY.id, stateId: U(31) } });
  });

  it('an initiative, an issue and a milestone update each carry their absolute fields', () => {
    const s = settle(snap({ cps: [cp()], tickets: [tk({ checkpointId: 1 })] }));
    s.program.title = 'Renamed programme';
    ep(s).checkpoints[0]!.title = 'Renamed checkpoint';
    ep(s).tickets[0]!.title = 'Renamed ticket';
    const { steps } = planSyncSteps(s);
    expect(ops(steps)).toEqual(['update:initiativeUpdate', 'update:projectUpdate', 'update:projectMilestoneUpdate', 'update:issueUpdate']);
    expect(stepOf(steps, 'initiativeUpdate')).toMatchObject({ fields: ['name', 'description', 'status'], input: { id: U(500), name: 'Renamed programme' } });
    expect(stepOf(steps, 'projectMilestoneUpdate').input).toMatchObject({ name: 'Renamed checkpoint' });
    expect(stepOf(steps, 'issueUpdate').input).toMatchObject({ title: 'Renamed ticket' });
  });

  it('a workspace reading unknown: no initiative step and no skip', () => {
    const { steps } = planSyncSteps(snap({ wsInitiatives: 'unknown' }));
    expect(ops(steps)).toEqual(['create:projectCreate']);
  });

  it('an initiative whose text names a private tracker key in a public project is skipped text-public', () => {
    const s = snap({ mode: 'public', inShort: 'See KEY-123 for the notes' });
    s.privateTrackerKeys = ['KEY'];
    expect(ops(planSyncSteps(s).steps)).toContain('skip:text-public');
    expect(ops(planSyncSteps(s).steps)).not.toContain('create:initiativeCreate');
  });

  it('a failed epic blocks its children and reports its inputs', () => {
    const s = snap({ cps: [cp()], tickets: [tk()] });
    s.bindings.push({ id: 50, localKind: 'epic', localId: 1, workspaceId: WSID, teamKey: 'AAA', linearId: null, identifier: null, fingerprint: null,
      syncedAt: null, state: 'failed', failedAt: 1, failedWord: 'linear-invalid', failedInputs: 'old', driftCount: 0, driftSince: null, heldItemId: null });
    const r = planSyncSteps(s);
    expect(ops(r.steps)).toEqual(['create:initiativeCreate']);
    expect(r.failedInputs).toHaveLength(1);
  });

  it('C14: a project\'s team ids are the epic\'s team plus the teams of its non-dropped tickets, sorted', () => {
    const s = snap({ tickets: [tk(), tk({ id: 2, key: 't2', project: 'proj-b' }), tk({ id: 3, key: 't3', project: 'proj-b', state: 'dropped', droppedWhy: 'x' })] });
    expect(stepOf(planSyncSteps(s).steps, 'projectCreate').input['teamIds']).toEqual([AAA.id, KEY.id].sort());
    const only = snap({ tickets: [tk({ id: 3, key: 't3', project: 'proj-b', state: 'dropped', droppedWhy: 'x' })] });
    expect(stepOf(planSyncSteps(only).steps, 'projectCreate').input['teamIds']).toEqual([AAA.id]);
  });

  it('a ticket moved into another team changes the project\'s team ids (one project update)', () => {
    const s = settle(snap({ tickets: [tk()] }));
    ep(s).tickets[0]!.project = 'proj-b';
    const { steps } = planSyncSteps(s);
    expect(ops(steps)).toContain('update:projectUpdate');
    expect(stepOf(steps, 'projectUpdate').input['teamIds']).toEqual([AAA.id, KEY.id].sort());
  });
});

describe('closes (design §5.4, one row each)', () => {
  const ended = (outcome: 'done' | 'abandoned', why: string | null = null) => ({ outcome, why, at: Date.parse('2026-11-20T09:00:00Z') });

  it('R6: a programme ended done reads Completed; an open epic\'s project completes; an open issue is left open and counted', () => {
    const s = settle(snap({ epic: { state: 'planned' }, tickets: [tk()] }));
    s.program.end = ended('done');
    const r = planSyncSteps(s);
    expect(ops(r.steps)).toEqual(['update:initiativeUpdate', 'update:projectUpdate']);
    expect(stepOf(r.steps, 'initiativeUpdate').input['status']).toBe('Completed');
    expect(stepOf(r.steps, 'projectUpdate').input['statusId']).toBe(U(33));
    expect(r.notices).toEqual([{ kind: 'open-issues-left', count: 1 }]);
  });

  it('R6: a programme ended abandoned reads Canceled with the Abandoned line; projects and open issues are canceled with a comment', () => {
    const s = settle(snap({ epic: { state: 'active' }, cps: [cp()], tickets: [tk({ checkpointId: 1 })] }));
    s.program.end = ended('abandoned', 'the plan was cut');
    const r = planSyncSteps(s);
    expect(ops(r.steps)).toEqual(['update:initiativeUpdate', 'update:projectUpdate', 'update:issueUpdate']);
    const init = stepOf(r.steps, 'initiativeUpdate');
    expect(init.input['status']).toBe('Canceled');
    expect(init.input['description']).toEqual(expect.stringContaining('Abandoned on 2026-11-20: the plan was cut'));
    expect(stepOf(r.steps, 'projectUpdate').input['statusId']).toBe(U(34));
    const issue = stepOf(r.steps, 'issueUpdate');
    expect(issue).toMatchObject({ stateType: 'canceled', input: { stateId: U(24) } });
    expect(issue.kind === 'update' && issue.comment).toMatchObject({ requestId: requestIdOf('ticket', 1, WSID, 'cancel'), body: expect.stringContaining('the plan was cut') });
    expect(r.notices).toEqual([]);
  });

  it('an abandoned programme leaves a done epic and a done issue as they are', () => {
    const s = settle(snap({ epic: { state: 'done' }, tickets: [tk({ state: 'done' })] }));
    s.program.end = ended('abandoned', 'cut');
    expect(ops(planSyncSteps(s).steps)).toEqual(['update:initiativeUpdate']);
  });

  it('an epic nothing was created for is not created by the end that would close it', () => {
    const s = snap({ epic: { state: 'planned' } });
    s.program.end = ended('abandoned', 'cut');
    expect(ops(planSyncSteps(s).steps)).toEqual(['create:initiativeCreate']);   // the initiative reads Canceled; no project is made
  });

  it('an epic dropped: its project is canceled with the reason in its description; a leftover open issue is canceled with a comment', () => {
    const s = settle(snap({ cps: [cp()], tickets: [tk({ checkpointId: 1 })] }));
    ep(s).state = 'dropped';
    ep(s).droppedWhy = 'out of scope';
    const r = planSyncSteps(s);
    expect(ops(r.steps)).toEqual(['update:initiativeUpdate', 'update:projectUpdate', 'update:issueUpdate']);
    const proj = stepOf(r.steps, 'projectUpdate').input;
    expect(proj['statusId']).toBe(U(34));
    expect(proj['description']).toEqual(expect.stringContaining('Dropped: out of scope'));
    const issue = stepOf(r.steps, 'issueUpdate');
    expect(issue.kind === 'update' && issue.comment?.body).toEqual(expect.stringContaining('out of scope'));
  });

  it('a dropped record that has a binding: project canceled, milestone marked dropped, issue canceled by type with the ticket\'s reason', () => {
    const s = settle(snap({ cps: [cp()], tickets: [tk({ checkpointId: 1 })] }));
    ep(s).checkpoints[0]!.state = 'dropped';
    ep(s).checkpoints[0]!.droppedWhy = 'no longer needed';
    ep(s).tickets[0]!.state = 'dropped';
    ep(s).tickets[0]!.droppedWhy = 'duplicate work';
    const { steps } = planSyncSteps(s);
    expect(stepOf(steps, 'projectMilestoneUpdate').input['description']).toEqual(expect.stringContaining('Dropped: no longer needed'));
    const issue = stepOf(steps, 'issueUpdate');
    expect(issue).toMatchObject({ stateType: 'canceled', input: { stateId: U(24) } });
    expect(issue.kind === 'update' && issue.comment?.body).toEqual(expect.stringContaining('duplicate work'));
    ep(s).state = 'dropped';
    ep(s).droppedWhy = 'cut';
    expect(stepOf(planSyncSteps(s).steps, 'projectUpdate').input['statusId']).toBe(U(34));
  });

  it('a dropped record with no binding sends nothing', () => {
    const s = snap({ tickets: [tk({ state: 'dropped', droppedWhy: 'x' })], epic: { state: 'dropped', droppedWhy: 'y' } });
    expect(ops(planSyncSteps(s).steps)).toEqual([]);
  });
});

describe('the team-key rule (Review Focus 3)', () => {
  it('no team key: skip no-team-key, nothing sent', () => {
    expect(ops(planSyncSteps(snap({ teamKey: null, tickets: [tk()] })).steps)).toEqual(['skip:no-team-key']);
  });

  it('a bound ticket whose project now resolves to another workspace: skip ticket-workspace-mismatch on its binding', () => {
    const s = settle(snap({ tickets: [tk()] }));
    s.workspaces.push({ workspaceId: 'ws-b', initiatives: 'on', directory, teams: [{ id: U(2), key: 'BBB' }] });
    s.projects.push({ project: 'proj-c', teamKey: 'BBB', workspaceId: 'ws-b', mode: 'private', initiatives: 'on' });
    ep(s).tickets[0]!.project = 'proj-c';
    const { steps } = planSyncSteps(s);
    expect(steps).toEqual([expect.objectContaining({ kind: 'skip', why: 'ticket-workspace-mismatch', bindingId: bindingOf(s, 'ticket').id })]);
  });

  it('a ticket binding in another workspace than where the epic and project now sit: that binding fails, nothing is created', () => {
    const s = settle(snap({ tickets: [tk()] }));
    const tb = bindingOf(s, 'ticket');
    tb.workspaceId = 'ws-old';
    const { steps } = planSyncSteps(s);
    expect(steps).toEqual([expect.objectContaining({ kind: 'skip', why: 'ticket-workspace-mismatch', bindingId: tb.id, workspaceId: 'ws-old' })]);
  });

  // F3: the ticket below is on a SECOND team (proj-b, team KEY), so the epic's project carries [AAA, KEY]; a rig whose two
  // projects share one team could not see a stray projectUpdate.
  it("F3: a bound ticket on a second team whose project key is cleared keeps its team on the epic's project: no projectUpdate", () => {
    const s = settle(snap({ tickets: [tk({ project: 'proj-b' })] }));
    s.projects[1] = { ...s.projects[1]!, teamKey: null, workspaceId: null };
    expect(ops(planSyncSteps(s).steps)).toEqual(['skip:no-team-key']);
  });

  it("F3: a bound ticket on a second team whose project key moved to another workspace keeps its team on the epic's project", () => {
    const s = settle(snap({ tickets: [tk({ project: 'proj-b' })] }));
    s.workspaces.push({ workspaceId: 'ws-b', initiatives: 'on', directory, teams: [{ id: U(2), key: 'BBB' }] });
    s.projects[1] = { ...s.projects[1]!, teamKey: 'BBB', workspaceId: 'ws-b' };
    expect(ops(planSyncSteps(s).steps)).toEqual(['skip:ticket-workspace-mismatch']);
  });

  it("M2: a bound ticket's project re-keyed inside the workspace: the project gains the new team first and drops the old one only after the move binds", () => {
    const BBB = { id: U(2), key: 'BBB' };
    const CCC = { id: U(4), key: 'CCC' };
    const s = snap({ tickets: [tk({ project: 'proj-b' })] });
    s.workspaces[0]!.teams = [AAA, BBB, CCC];
    s.workspaces[0]!.directory = { ...directory, states: ['AAA', 'BBB', 'CCC'].flatMap((teamKey, i) => [
      { id: U(41 + i * 10), name: 'Todo', type: 'unstarted', teamKey }, { id: U(42 + i * 10), name: 'Doing', type: 'started', teamKey },
      { id: U(43 + i * 10), name: 'Done', type: 'completed', teamKey }, { id: U(44 + i * 10), name: 'Nope', type: 'canceled', teamKey }]) };
    s.projects[1] = { ...s.projects[1]!, teamKey: 'BBB' };
    settle(s);
    expect(bindingOf(s, 'ticket').teamKey).toBe('BBB');
    s.projects[1] = { ...s.projects[1]!, teamKey: 'CCC' };
    const first = planSyncSteps(s).steps;
    expect(ops(first)).toEqual(['update:projectUpdate', 'update:issueUpdate']);
    expect(stepOf(first, 'projectUpdate').input['teamIds']).toEqual([AAA.id, BBB.id, CCC.id].sort());   // BBB kept until the move binds
    const move = stepOf(first, 'issueUpdate');
    expect(move).toMatchObject({ teamKey: 'CCC', input: { teamId: CCC.id } });
    bindingOf(s, 'epic').fingerprint = stepOf(first, 'projectUpdate').fingerprint;
    Object.assign(bindingOf(s, 'ticket'), { fingerprint: move.fingerprint, teamKey: 'CCC' });   // the move bound
    const after = planSyncSteps(s).steps;
    expect(ops(after)).toEqual(['update:projectUpdate']);
    expect(stepOf(after, 'projectUpdate').input['teamIds']).toEqual([AAA.id, CCC.id].sort());
  });

  it("F2: the epic's project key moved to another workspace creates nothing there; the old workspace's initiative is still updated and closed", () => {
    const s = settle(snap({ cps: [cp()], tickets: [tk()] }));
    s.workspaces.push({ workspaceId: 'ws-b', initiatives: 'on', directory, teams: [{ id: U(2), key: 'BBB' }] });
    s.projects[0] = { ...s.projects[0]!, teamKey: 'BBB', workspaceId: 'ws-b' };
    const { steps } = planSyncSteps(s);
    expect(steps.filter((x) => x.kind === 'create')).toEqual([]);
    expect(steps).toEqual([expect.objectContaining({ kind: 'skip', why: 'workspace-mismatch', bindingId: bindingOf(s, 'epic').id, workspaceId: WSID })]);
    s.program.title = 'Renamed programme';
    expect(stepOf(planSyncSteps(s).steps, 'initiativeUpdate')).toMatchObject({ workspaceId: WSID, input: { name: 'Renamed programme' } });
    s.program.end = { outcome: 'done', why: null, at: Date.parse('2026-11-20T09:00:00Z') };
    const closed = planSyncSteps(s).steps;
    expect(stepOf(closed, 'initiativeUpdate')).toMatchObject({ workspaceId: WSID, input: { status: 'Completed' } });
    expect(closed.filter((x) => x.kind === 'create')).toEqual([]);
  });

  it('F2: an unbound epic placed in another workspace still has its initiative created there', () => {
    const s = settle(snap());
    s.workspaces.push({ workspaceId: 'ws-b', initiatives: 'on', directory, teams: [{ id: U(2), key: 'BBB' }] });
    s.projects.push({ project: 'proj-c', teamKey: 'BBB', workspaceId: 'ws-b', mode: 'private', initiatives: 'on' });
    s.plan.epics.push({ ...epic({ id: 2, key: 'e2', project: 'proj-c', title: 'Epic two' }), checkpoints: [], tickets: [] });
    const { steps } = planSyncSteps(s);
    expect(steps.filter((x) => x.kind === 'create').map((x) => [x.kind === 'create' ? x.op : '', x.workspaceId]))
      .toEqual([['initiativeCreate', 'ws-b'], ['projectCreate', 'ws-b']]);
  });

  it('an epic binding in another workspace than its project now resolves to: that binding fails and nothing under it is sent', () => {
    const s = settle(snap({ cps: [cp()], tickets: [tk()] }));
    const eb = bindingOf(s, 'epic');
    eb.workspaceId = 'ws-old';
    const { steps } = planSyncSteps(s);
    expect(steps.filter((x) => x.kind !== 'skip' || x.why !== 'workspace-mismatch')).toEqual([]);
    expect(steps).toEqual([expect.objectContaining({ kind: 'skip', why: 'workspace-mismatch', bindingId: eb.id, workspaceId: 'ws-old' })]);
  });
});

// ═══ Layer 2: the pass ═══

const SLUG = 'prog-a';
const OWNER = 'coord-a';
const DIR: LinearDirectoryEntries = {
  viewerId: U(900), labels: [], projects: [], users: [], initiatives: 'on',
  states: ['AAA', 'CCC'].flatMap((teamKey, i) => [
    { id: U(21 + i * 10), name: 'Todo', type: 'unstarted', teamKey }, { id: U(22 + i * 10), name: 'Doing', type: 'started', teamKey },
    { id: U(23 + i * 10), name: 'Done', type: 'completed', teamKey }, { id: U(24 + i * 10), name: 'Nope', type: 'canceled', teamKey }]),
  projectStatuses: directory.projectStatuses,
};
const CCC_TEAM = { id: 'cccccccc-1111-4000-8000-00000000000c', key: 'CCC', name: 'Team C' };
const ok = (value: Record<string, unknown> = {}, created: string | null = null): CcrcOpOutcome => ({ ok: true, value, created });
const changes = (over: Partial<PlanChanges>): PlanChanges => ({ ...NO_PLAN_CHANGES(), ...over });
const ticket = (key: string, over: Partial<NewTicket> = {}): NewTicket => ({
  program: SLUG, epicKey: 'e1', checkpointKey: null, key, kind: 'work', title: `Ticket ${key}`, body: 'Do it', project: 'project-a', source: 'plan', ...over,
});

type Respond = (ask: CcrcOpAsk) => CcrcOpOutcome;
let counter = 2000;
const defaultRespond: Respond = (ask) => {
  if (ask.op.endsWith('Create')) {
    const id = U(counter++);
    return ok(ask.op === 'issueCreate' ? { id, identifier: `AAA-${counter}` } : { id }, id);
  }
  if (ask.op === 'issueComment') return ok({ id: U(counter++) });
  if (ask.op.endsWith('Update')) return ok(ask.op === 'issueUpdate' ? { id: ask.target, identifier: String(ask.target) } : { id: ask.target });
  if (ask.op === 'initiativesByName' || ask.op === 'projectsByName') return ok({ nodes: [] });
  return { ok: false, word: 'not-found', maybeSent: false };
};

interface Rig {
  db: DatabaseSync; coord: CoordStore; plan: PlanStorePort; t: { now: number }; asks: CcrcOpAsk[]; respond: { current: Respond }; sync: PlanSync;
  ccrcDir: string;
}
let dirs: string[] = [];
async function rig(o: { epics?: 'one' | 'two'; ticket?: boolean; itemId?: number; extraTeam?: boolean; slotB?: boolean } = {}): Promise<Rig> {
  const dir = mkTmp('ccrc-plan-life-');
  dirs.push(dir);
  const ccrcDir = path.join(dir, '.ccrc');
  await seedSlot(ccrcDir, 'a', o.extraTeam === true ? { teams: [...WS.a.teams, CCC_TEAM] } : {});
  if (o.slotB === true) await seedSlot(ccrcDir, 'b');
  const db = memCoordDb();
  const coord = new CoordStore(db);
  db.prepare('INSERT INTO project_linking (project, teamKey, override) VALUES (?, ?, ?)').run('project-a', 'AAA', 'private');
  db.prepare('INSERT INTO project_linking (project, teamKey, override) VALUES (?, ?, ?)').run('project-b', 'AAA', 'private');
  const two = o.epics === 'two';
  applyPlanChanges(db, SLUG, changes({
    epics: { insert: [
      { key: 'e1', project: 'project-a', waves: [1], ordinal: 0, title: 'Epic one', summary: 'Summary' },
      ...(two ? [{ key: 'e2', project: 'project-a', waves: [2], ordinal: 1, title: 'Epic two', summary: 'Summary two' }] : []),
    ], update: [], drop: [] },
    checkpoints: { insert: [
      { epicKey: 'e1', key: 'c1', ordinal: 0, title: 'Checkpoint one', kind: 'acceptance', proves: [], itemId: null },
      ...(o.itemId === undefined ? [] : [{ epicKey: 'e1', key: 'c2', ordinal: 1, title: 'Operator step', kind: 'operator-act' as const, proves: [], itemId: o.itemId }]),
    ], update: [], drop: [] },
    tickets: { insert: o.ticket === false ? [] : [ticket('t1')], update: [], drop: [] },
  }), OWNER, T, { home: 'project-a', title: 'Programme A' });
  const r = { db, coord, plan: planStorePort(db), t: { now: T }, asks: [] as CcrcOpAsk[], respond: { current: defaultRespond }, ccrcDir } as Rig;
  r.sync = new PlanSync({
    coord, plan: r.plan, ccrcDir, readLinearStore: () => readLinearStore(ccrcDir),
    call: async (ask) => { r.asks.push(ask); return r.respond.current(ask); },
    directory: { get: () => DIR, filledAt: () => T - 1000, projectStatusesRead: () => 'read' },
    directoryMiss: () => undefined, markSlotRejected: async () => undefined,
    now: () => r.t.now, privateTrackerKeys: [],
  });
  return r;
}
afterEach(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* the reaper */ } } dirs = []; });

/** One tick, a debounce after the last mark. */
async function tick(r: Rig): Promise<void> { r.t.now += PLAN_SYNC_DEBOUNCE_MS + 1_000; await r.sync.tick(r.t.now); }
const due = (r: Rig): void => { r.plan.markSyncDue(SLUG, r.t.now); };
const opsOf = (r: Rig, from = 0): string[] => r.asks.slice(from).map((a) => a.op);
const mails = (r: Rig): { subject: string; body: string }[] =>
  r.db.prepare("SELECT subject, body FROM mail WHERE subject LIKE 'Linear sync%' ORDER BY id").all() as { subject: string; body: string }[];
const epicRow = (r: Rig, key: string) => r.plan.planOf(SLUG).epics.find((e) => e.key === key)!;
const sentInput = (r: Rig, op: string, from = 0): Record<string, unknown> => r.asks.slice(from).find((a) => a.op === op)!.input as Record<string, unknown>;

async function runIt(r: Rig, epicId: number, wave: number): Promise<number> {
  const res = r.coord.openRun({ program: SLUG, title: `Wave ${wave}`, project: 'project-a', wave, waveOf: 2, claimedBy: OWNER, homeProject: 'project-a',
    ticket: { kind: 'new', epicId, project: 'project-a', title: `Wave ${wave}` } });
  if ('refused' in res) throw new Error(`open refused ${String(res.refused)}`);
  return (res as { id: number }).id;
}

describe('the pass: moves and closes', () => {
  it('an operator-act checkpoint is met when its item is done', async () => {
    const r = await tickable();
    async function tickable(): Promise<Rig> {
      const first = await rig({ ticket: false });
      return first;
    }
    const itemId = r.coord.raiseItem({ program: SLUG, runId: null, raisedBy: OWNER, kind: 'do', title: 'Do a step', why: 'Needed', how: ['Do it'], options: null, neededBy: 'later', soonLabel: null, secretSlot: null }, T);
    const cpRow = epicRow(r, 'e1').checkpoints[0]!;
    r.db.prepare("UPDATE plan_checkpoints SET kind = 'operator-act', itemId = ? WHERE id = ?").run(itemId, cpRow.id);
    await r.sync.tick(T + 100_000);                                    // the item is open: not met
    expect(epicRow(r, 'e1').checkpoints[0]!.state).toBe('open');
    r.db.prepare("UPDATE operator_items SET state = 'done', closedAt = ? WHERE id = ?").run(T, itemId);
    const from = r.asks.length;
    await r.sync.tick(T + 200_000);
    const met = epicRow(r, 'e1').checkpoints[0]!;
    expect(met).toMatchObject({ state: 'met', evidence: { itemId } });
    expect(r.asks.slice(from).some((a) => a.op === 'projectMilestoneUpdate' && String(a.input['description']).includes(`Met on `))).toBe(true);
  });

  it('plan met on the last checkpoint after the last run closes the epic, and its project completes', async () => {
    const r = await rig({ ticket: false });
    const run = await runIt(r, epicRow(r, 'e1').id, 1);
    expect(r.coord.advance(run, 'dispatched', 'test').ok).toBe(true);
    expect(r.coord.closeRun({ runId: run, finalState: 'done', causedBy: 'test', handoffCommit: null, program: SLUG, viaClosing: true }).ok).toBe(true);
    expect(epicRow(r, 'e1').state).toBe('active');                       // its checkpoint is still open
    await tick(r);
    const from = r.asks.length;
    r.plan.markCheckpointMet(epicRow(r, 'e1').checkpoints[0]!.id, { pr: 12 }, r.t.now);
    expect(epicRow(r, 'e1').state).toBe('done');
    await tick(r);
    const upd = r.asks.slice(from).find((a) => a.op === 'projectUpdate')!;
    expect(upd.input['statusId']).toBe(U(33));
  });

  it('the last epic settling done with programs.state done ends the programme and completes the initiative', async () => {
    const r = await rig({ ticket: false });
    const run = await runIt(r, epicRow(r, 'e1').id, 1);
    expect(r.coord.advance(run, 'dispatched', 'test').ok).toBe(true);
    expect(r.coord.closeRun({ runId: run, finalState: 'done', causedBy: 'test', handoffCommit: null, program: SLUG, viaClosing: true }).ok).toBe(true);
    r.plan.markCheckpointMet(epicRow(r, 'e1').checkpoints[0]!.id, { pr: 12 }, r.t.now);
    expect((r.db.prepare('SELECT state FROM programs WHERE slug = ?').get(SLUG) as { state: string }).state).toBe('done');
    await tick(r);
    expect(sentInput(r, 'initiativeCreate')['status']).toBe('Completed');
  });

  it('the last run of wave 1 closes done while later epics are planned, and nothing in Linear closes', async () => {
    const r = await rig({ epics: 'two', ticket: false });
    await tick(r);                                                      // bind everything first
    const from = r.asks.length;
    const run = await runIt(r, epicRow(r, 'e1').id, 1);
    expect(r.coord.advance(run, 'dispatched', 'test').ok).toBe(true);
    expect(r.coord.closeRun({ runId: run, finalState: 'done', causedBy: 'test', handoffCommit: null, program: SLUG, viaClosing: true }).ok).toBe(true);
    expect((r.db.prepare('SELECT state FROM programs WHERE slug = ?').get(SLUG) as { state: string }).state).toBe('done');
    expect(epicRow(r, 'e2').state).toBe('planned');
    r.plan.markSyncDue(SLUG, r.t.now);
    await tick(r);
    const sent = r.asks.slice(from);
    expect(sent.filter((a) => a.op === 'initiativeUpdate').every((a) => a.input['status'] === 'Active')).toBe(true);
    expect(sent.some((a) => a.op === 'issueComment')).toBe(false);
    expect(sent.some((a) => a.op === 'projectUpdate' && a.input['statusId'] === U(34))).toBe(false);
    expect(sent.some((a) => a.op === 'projectUpdate' && String(a.target) === String(r.plan.bindingsOf(SLUG).find((b) => b.localKind === 'epic' && b.localId === epicRow(r, 'e2').id)!.linearId))).toBe(false);
  });

  it('the last run of wave 1 closes failed (programs.state abandoned), and nothing is canceled', async () => {
    const r = await rig({ epics: 'two', ticket: false });
    await tick(r);
    const from = r.asks.length;
    const run = await runIt(r, epicRow(r, 'e1').id, 1);
    expect(r.coord.advance(run, 'dispatched', 'test').ok).toBe(true);
    expect(r.coord.closeRun({ runId: run, finalState: 'failed', causedBy: 'test', handoffCommit: null, program: SLUG, viaClosing: true }).ok).toBe(true);
    expect((r.db.prepare('SELECT state FROM programs WHERE slug = ?').get(SLUG) as { state: string }).state).toBe('abandoned');
    r.plan.markSyncDue(SLUG, r.t.now);
    await tick(r);
    const sent = r.asks.slice(from);
    expect(sent.some((a) => a.op === 'initiativeUpdate' && a.input['status'] === 'Canceled')).toBe(false);
    expect(sent.some((a) => a.op === 'issueComment')).toBe(false);
    expect(sent.some((a) => a.input['statusId'] === U(34) || a.input['stateId'] === U(24))).toBe(false);
  });

  it('plan close abandoned cancels projects and open issues with the reason', async () => {
    const r = await rig();
    await tick(r);
    expect(r.plan.bindingsOf(SLUG).every((b) => b.state === 'bound')).toBe(true);
    const from = r.asks.length;
    r.plan.closePlan(SLUG, 'abandoned', 'the work moved to another programme', r.t.now);
    await tick(r);
    const sent = r.asks.slice(from);
    expect(opsOf(r, from)).toEqual(['initiativeUpdate', 'projectUpdate', 'issueOwned', 'issueComment', 'issueUpdate', 'initiativeToProjectCreate']);
    expect(sent[0]!.input).toMatchObject({ status: 'Canceled', description: expect.stringContaining('Abandoned on ') });
    expect(sent[1]!.input['statusId']).toBe(U(34));
    expect(sent[3]!.input['body']).toEqual(expect.stringContaining('the work moved to another programme'));
    // D-8183: the journal's closed list for a comment names `body`; a cancel comment naming another field is refused by the real journal.
    expect(sent[3]!.fields).toEqual(['body']);
    expect(sent[4]!.input['stateId']).toBe(U(24));
    expect(r.plan.bindingsOf(SLUG).every((b) => b.state === 'bound')).toBe(true);
    const settled = r.asks.length;
    due(r); await tick(r);
    expect(r.asks).toHaveLength(settled);                                // the cancel is recorded: nothing again
  });

  it('plan close done with an open issue mails the coordinator once, in a fixed sentence', async () => {
    const r = await rig();
    await tick(r);
    r.plan.closePlan(SLUG, 'done', null, r.t.now);
    await tick(r);
    due(r); await tick(r);
    const m = mails(r).filter((x) => x.subject.includes('open-issues-left'));
    expect(m).toHaveLength(1);
    expect(m[0]!.body).toBe(`The programme ${SLUG} has ended as done with 1 open issue in Linear. The sync left it open: close or re-plan it.`);
    expect(sentInput(r, 'initiativeUpdate', 0)['status']).toBe('Completed');
    expect(r.asks.some((a) => a.op === 'issueComment' || a.input['stateId'] === U(24))).toBe(false);
  });

  it('a dropped ticket\'s cancel comment names its droppedWhy, once, and a conflict answer counts as made', async () => {
    const r = await rig();
    await tick(r);
    const t1 = epicRow(r, 'e1').tickets[0]!;
    const from = r.asks.length;
    r.plan.applyPlanChanges(SLUG, changes({ tickets: { insert: [], update: [], drop: [{ id: t1.id, why: 'duplicates the other ticket' }] } }), OWNER, r.t.now, null);
    r.respond.current = (ask) => (ask.op === 'issueComment' ? { ok: false, word: 'linear-invalid', maybeSent: false, detail: 'conflict' } : defaultRespond(ask));
    await tick(r);
    const sent = r.asks.slice(from);
    const comment = sent.find((a) => a.op === 'issueComment')!;
    expect(comment.input).toMatchObject({ requestId: requestIdOf('ticket', t1.id, WS.a.id, 'cancel'), body: expect.stringContaining('duplicates the other ticket') });
    expect(sent.some((a) => a.op === 'issueUpdate' && a.input['stateId'] === U(24))).toBe(true);   // the conflict did not stop the cancel
    expect(r.plan.bindingsOf(SLUG).find((b) => b.localKind === 'ticket')!.state).toBe('bound');
    const n = r.asks.length;
    due(r); await tick(r);
    expect(r.asks).toHaveLength(n);
  });

  it('a cleared team key leaves bindings and syncs nothing for that project', async () => {
    const r = await rig();
    await tick(r);
    const before = r.plan.bindingsOf(SLUG).map((b) => [b.id, b.state, b.linearId]);
    r.db.prepare('UPDATE project_linking SET teamKey = NULL WHERE project = ?').run('project-a');
    const from = r.asks.length;
    r.plan.applyPlanChanges(SLUG, changes({ epics: { insert: [], update: [{ id: epicRow(r, 'e1').id, title: 'Renamed epic' }], drop: [] } }), OWNER, r.t.now, null);
    await tick(r);
    expect(r.asks).toHaveLength(from);
    expect(r.plan.bindingsOf(SLUG).map((b) => [b.id, b.state, b.linearId])).toEqual(before);
  });

  it('a team key moved to another workspace fails the bindings and moves nothing', async () => {
    const r = await rig({ slotB: true });
    r.plan.applyPlanChanges(SLUG, changes({ tickets: { insert: [ticket('t2', { project: 'project-b' })], update: [], drop: [] } }), OWNER, r.t.now, null);
    await tick(r);
    const t2 = epicRow(r, 'e1').tickets.find((t) => t.key === 't2')!;
    const tb = r.plan.bindingsOf(SLUG).find((b) => b.localKind === 'ticket' && b.localId === t2.id)!;
    expect(tb).toMatchObject({ state: 'bound', workspaceId: WS.a.id });
    r.db.prepare("UPDATE project_linking SET teamKey = 'BBB' WHERE project = 'project-b'").run();
    const from = r.asks.length;
    due(r); await tick(r);
    expect(r.plan.bindingsOf(SLUG).find((b) => b.id === tb.id)).toMatchObject({ state: 'failed', failedWord: 'ticket-workspace-mismatch', workspaceId: WS.a.id });
    expect(r.asks.slice(from).filter((a) => a.op.endsWith('Create') || a.op.endsWith('Update'))).toEqual([]);
    expect(r.plan.bindingsOf(SLUG).some((b) => b.workspaceId === WS.b.id)).toBe(false);          // no binding made in the new workspace
    expect(mails(r).filter((m) => m.subject.includes('ticket-workspace-mismatch'))).toHaveLength(1);
  });

  it("F2: the epic's project re-keyed into another workspace: no create there, the epic fails workspace-mismatch, the old initiative closes at the end", async () => {
    const r = await rig({ slotB: true });
    await tick(r);
    r.db.prepare("UPDATE project_linking SET teamKey = 'BBB' WHERE project = 'project-a'").run();
    const from = r.asks.length;
    due(r); await tick(r);
    expect(r.asks.slice(from).filter((a) => a.op.endsWith('Create'))).toEqual([]);
    const eb = r.plan.bindingsOf(SLUG).find((b) => b.localKind === 'epic')!;
    expect(eb).toMatchObject({ state: 'failed', failedWord: 'workspace-mismatch', workspaceId: WS.a.id });
    expect(r.plan.bindingsOf(SLUG).some((b) => b.workspaceId === WS.b.id)).toBe(false);
    const ended = r.asks.length;
    r.plan.closePlan(SLUG, 'done', null, r.t.now);
    await tick(r);
    expect(r.asks.slice(ended).filter((a) => a.op.endsWith('Create'))).toEqual([]);
    expect(r.asks.slice(ended).find((a) => a.op === 'initiativeUpdate')).toMatchObject({ workspaceId: WS.a.id, input: { status: 'Completed' } });
  });

  /** F3's pass rig: t2 in project-b on a SECOND team (CCC, the slot's extra team), so the epic's project carries [AAA, CCC]. */
  async function secondTeam(slotB = false): Promise<{ r: Rig; t2: number }> {
    const r = await rig({ extraTeam: true, slotB });
    r.db.prepare("UPDATE project_linking SET teamKey = 'CCC' WHERE project = 'project-b'").run();
    r.plan.applyPlanChanges(SLUG, changes({ tickets: { insert: [ticket('t2', { project: 'project-b' })], update: [], drop: [] } }), OWNER, r.t.now, null);
    await tick(r);
    expect(sentInput(r, 'projectCreate')['teamIds']).toEqual([WS.a.teams[0].id, CCC_TEAM.id].sort());
    return { r, t2: epicRow(r, 'e1').tickets.find((t) => t.key === 't2')!.id };
  }

  it("D-8183 (round 1 A1): a ticket added later on a second team: the project gains the team (projectUpdate) before the issue is created (issueCreate)", async () => {
    const r = await rig({ extraTeam: true });
    await tick(r);
    r.db.prepare("UPDATE project_linking SET teamKey = 'CCC' WHERE project = 'project-b'").run();
    r.plan.applyPlanChanges(SLUG, changes({ tickets: { insert: [ticket('t2', { project: 'project-b' })], update: [], drop: [] } }), OWNER, r.t.now, null);
    const from = r.asks.length;
    await tick(r);
    const sent = opsOf(r, from);
    expect(sent).toContain('issueCreate');
    expect(sent.indexOf('projectUpdate')).toBeGreaterThanOrEqual(0);
    expect(sent.indexOf('projectUpdate')).toBeLessThan(sent.indexOf('issueCreate'));
    expect(sentInput(r, 'projectUpdate', from)['teamIds']).toEqual([WS.a.teams[0].id, CCC_TEAM.id].sort());
    expect(sentInput(r, 'issueCreate', from)['teamId']).toBe(CCC_TEAM.id);
  });

  it('D-8183 (round 1 A11): a create lost under the old team key is adopted under the changed key, then the next pass sends the move', async () => {
    const r = await rig({ extraTeam: true });
    r.db.prepare("UPDATE project_linking SET teamKey = 'AAA' WHERE project = 'project-b'").run();
    r.plan.applyPlanChanges(SLUG, changes({ tickets: { insert: [ticket('t2', { project: 'project-b' })], update: [], drop: [] } }), OWNER, r.t.now, null);
    r.respond.current = (ask) => (ask.op === 'issueCreate' && ask.input['title'] === 'Ticket t2' ? { ok: false, word: 'timeout', maybeSent: true } : defaultRespond(ask));
    await tick(r);                                         // the create is sent and its reply lost: the binding stays pending
    const lost = r.asks.find((a) => a.op === 'issueCreate' && a.input['title'] === 'Ticket t2')!;
    const t2 = epicRow(r, 'e1').tickets.find((t) => t.key === 't2')!.id;
    expect(r.plan.bindingsOf(SLUG).find((b) => b.localKind === 'ticket' && b.localId === t2)).toMatchObject({ state: 'pending' });
    r.db.prepare("UPDATE project_linking SET teamKey = 'CCC' WHERE project = 'project-b'").run();   // the key changes before the recovery
    r.respond.current = (ask) => {
      if (ask.op === 'issueCreate' && ask.input['title'] === 'Ticket t2') return { ok: false, word: 'linear-invalid', maybeSent: false, detail: 'conflict' };
      if (ask.op === 'issueOwned' && ask.input['id'] === lost.input['requestId']) return ok({ issue: { id: lost.input['requestId'], identifier: 'AAA-42', teamKey: 'AAA', stateType: 'unstarted' } });
      return defaultRespond(ask);
    };
    r.t.now += 400_000;                                    // past the backoff of the lost create's timeout hold
    const from = r.asks.length;
    due(r); await tick(r);
    expect(r.plan.bindingsOf(SLUG).find((b) => b.localKind === 'ticket' && b.localId === t2)).toMatchObject({ state: 'bound', teamKey: 'CCC' });      // the move's ok records the planned team
    expect(r.asks.slice(from).find((a) => a.op === 'issueUpdate' && a.target === 'AAA-42')).toMatchObject({ teamKey: 'AAA', destinationTeamKey: 'CCC' });
  });

  it("F3: a second team's ticket whose project key is cleared sends no projectUpdate (the team stays on the epic's project)", async () => {
    const { r } = await secondTeam();
    r.db.prepare('UPDATE project_linking SET teamKey = NULL WHERE project = ?').run('project-b');
    const from = r.asks.length;
    due(r); await tick(r);
    expect(r.asks.slice(from)).toEqual([]);
  });

  it("M2: a second team's ticket re-keyed inside the workspace: no projectUpdate drops its team before the move binds", async () => {
    const { r, t2 } = await secondTeam();
    r.db.prepare("UPDATE project_linking SET teamKey = 'AAA' WHERE project = 'project-b'").run();
    r.respond.current = (ask) => (ask.op === 'issueOwned' ? ok({ issue: { id: ask.input['id'], identifier: 'CCC-1', stateType: 'unstarted', teamKey: 'CCC' } })
      : ask.op === 'issueUpdate' ? ok({ id: ask.target, identifier: 'AAA-77' }) : defaultRespond(ask));
    const from = r.asks.length;
    due(r); await tick(r);
    const sent = r.asks.slice(from);
    const moved = sent.findIndex((a) => a.op === 'issueUpdate');
    expect(moved).toBeGreaterThanOrEqual(0);
    for (const a of sent.slice(0, moved).filter((x) => x.op === 'projectUpdate')) expect(a.input['teamIds']).toContain(CCC_TEAM.id);
    expect(r.plan.bindingsOf(SLUG).find((b) => b.localKind === 'ticket' && b.localId === t2)).toMatchObject({ state: 'bound', teamKey: 'AAA' });
    const drop = sent.slice(moved).find((a) => a.op === 'projectUpdate');                       // CCC goes only after the move
    expect(drop?.input['teamIds']).toEqual([WS.a.teams[0].id]);
  });

  it("F3: a second team's ticket whose project key moved to another workspace sends no projectUpdate, and its binding fails once", async () => {
    const { r, t2 } = await secondTeam(true);
    r.db.prepare("UPDATE project_linking SET teamKey = 'BBB' WHERE project = 'project-b'").run();
    const from = r.asks.length;
    due(r); await tick(r);
    expect(opsOf(r, from)).toEqual([]);
    expect(r.plan.bindingsOf(SLUG).find((b) => b.localKind === 'ticket' && b.localId === t2)).toMatchObject({ state: 'failed', failedWord: 'ticket-workspace-mismatch' });
  });

  it('A2: a workspace-mismatch skip whose old workspace has no slot fails the binding and mails once; the programme is not due again', async () => {
    const r = await rig();
    await tick(r);
    const eb = r.plan.bindingsOf(SLUG).find((b) => b.localKind === 'epic')!;
    r.db.prepare("UPDATE linear_bindings SET workspaceId = 'ws-old' WHERE id = ?").run(eb.id);     // no slot serves ws-old
    const from = r.asks.length;
    due(r); await tick(r);
    expect(r.plan.bindingsOf(SLUG).find((b) => b.id === eb.id)).toMatchObject({ state: 'failed', failedWord: 'workspace-mismatch', workspaceId: 'ws-old' });
    expect(mails(r).filter((m) => m.subject.includes('workspace-mismatch'))).toHaveLength(1);
    expect(r.db.prepare('SELECT 1 FROM plan_sync_due WHERE program = ?').get(SLUG)).toBeUndefined();
    const failedAt = r.plan.bindingsOf(SLUG).find((b) => b.id === eb.id)!.failedAt;
    await tick(r); await tick(r);                                       // two more 5 s beats: nothing re-runs
    expect(r.asks).toHaveLength(from);
    expect(r.plan.bindingsOf(SLUG).find((b) => b.id === eb.id)!.failedAt).toBe(failedAt);
    expect(mails(r).filter((m) => m.subject.includes('workspace-mismatch'))).toHaveLength(1);
  });

  it('a ticket re-projected inside the workspace moves teams, and the identifier is refreshed from the answer', async () => {
    const r = await rig({ extraTeam: true });
    r.plan.applyPlanChanges(SLUG, changes({ tickets: { insert: [ticket('t2', { project: 'project-b' })], update: [], drop: [] } }), OWNER, r.t.now, null);
    await tick(r);
    const t2 = epicRow(r, 'e1').tickets.find((t) => t.key === 't2')!;
    r.db.prepare("UPDATE project_linking SET teamKey = 'CCC' WHERE project = 'project-b'").run();
    r.respond.current = (ask) => {
      if (ask.op === 'issueUpdate') return ok({ id: ask.target, identifier: 'CCC-9' });
      if (ask.op === 'issueOwned') return ok({ issue: { id: ask.input['id'], stateType: 'unstarted', teamKey: 'AAA' } });
      return defaultRespond(ask);
    };
    const from = r.asks.length;
    due(r); await tick(r);
    const upd = r.asks.slice(from).find((a) => a.op === 'issueUpdate')!;
    expect(upd.input['teamId']).toBe(CCC_TEAM.id);
    expect(upd.teamKey).toBe('AAA');                                    // the ask carries the issue's CURRENT team, read from Linear
    expect(upd.destinationTeamKey).toBe('CCC');                         // C15: and the team it moves into, for the policy
    expect(r.plan.bindingsOf(SLUG).find((b) => b.localKind === 'ticket' && b.localId === t2.id)).toMatchObject({ state: 'bound', identifier: 'CCC-9', teamKey: 'CCC' });
  });

  it('a ticket\'s own project with its key cleared is inert: no failure, no mail, no call, and plan show reads unsynced', async () => {
    const r = await rig();
    r.plan.applyPlanChanges(SLUG, changes({ tickets: { insert: [ticket('t2', { project: 'project-b' })], update: [], drop: [] } }), OWNER, r.t.now, null);
    await tick(r);
    const t2 = epicRow(r, 'e1').tickets.find((t) => t.key === 't2')!;
    const before = r.plan.bindingsOf(SLUG).map((b) => ({ ...b }));
    r.db.prepare('UPDATE project_linking SET teamKey = NULL WHERE project = ?').run('project-b');
    r.db.prepare("UPDATE plan_tickets SET title = 'Renamed' WHERE id = ?").run(t2.id);
    const from = r.asks.length;
    due(r); await tick(r);
    expect(r.asks).toHaveLength(from);
    expect(r.plan.bindingsOf(SLUG)).toEqual(before);
    expect(mails(r)).toEqual([]);
    const view = planViewOf(r.plan.planOf(SLUG), [], r.plan.bindingsOf(SLUG), (p) => r.coord.linkingOf(p).teamKey);
    const e1 = view.epics[0]!;
    expect(e1.sync).toBe('bound');
    expect(e1.tickets.find((t) => t.key === 't2')).toMatchObject({ sync: 'unsynced', syncWord: null });
    expect(e1.tickets.find((t) => t.key === 't1')!.sync).toBe('bound');
  });

  it('plan show reads unsynced for an epic and its checkpoints when the epic\'s project has no key; the bindings are unchanged', async () => {
    const r = await rig();
    await tick(r);
    const before = r.plan.bindingsOf(SLUG).map((b) => ({ ...b }));
    r.db.prepare('UPDATE project_linking SET teamKey = NULL WHERE project = ?').run('project-a');
    const view = planViewOf(r.plan.planOf(SLUG), [], r.plan.bindingsOf(SLUG), (p) => r.coord.linkingOf(p).teamKey);
    expect(view.epics[0]).toMatchObject({ sync: 'unsynced', syncWord: null });
    expect(view.epics[0]!.checkpoints.every((c) => c.sync === 'unsynced')).toBe(true);
    expect(r.plan.bindingsOf(SLUG)).toEqual(before);
    expect(planViewOf(r.plan.planOf(SLUG), [], r.plan.bindingsOf(SLUG)).epics[0]!.sync).toBe('bound');   // no reader: as before
  });

  it('a failed ticket-workspace-mismatch is told once: a second pass leaves failedAt unchanged', async () => {
    const r = await rig({ slotB: true });
    r.plan.applyPlanChanges(SLUG, changes({ tickets: { insert: [ticket('t2', { project: 'project-b' })], update: [], drop: [] } }), OWNER, r.t.now, null);
    await tick(r);
    r.db.prepare("UPDATE project_linking SET teamKey = 'BBB' WHERE project = 'project-b'").run();
    due(r); await tick(r);
    const failed = r.plan.bindingsOf(SLUG).find((b) => b.state === 'failed')!;
    expect(failed.failedWord).toBe('ticket-workspace-mismatch');
    due(r); await tick(r);
    due(r); await tick(r);
    expect(r.plan.bindingsOf(SLUG).find((b) => b.id === failed.id)!.failedAt).toBe(failed.failedAt);
  });
});

describe('C12: a state change by type reads the issue first', () => {
  async function started(): Promise<{ r: Rig; created: Record<string, unknown>; from: number }> {
    const r = await rig();
    await tick(r);
    const create = r.asks.find((a) => a.op === 'issueCreate')!.input as Record<string, unknown>;
    const t1 = epicRow(r, 'e1').tickets[0]!;
    r.db.prepare("UPDATE plan_tickets SET state = 'started' WHERE id = ?").run(t1.id);
    r.plan.markSyncDue(SLUG, r.t.now);
    return { r, created: create, from: r.asks.length };
  }
  const answer = (r: Rig, created: Record<string, unknown>, over: Record<string, unknown> = {}) => (ask: CcrcOpAsk): CcrcOpOutcome => {
    if (ask.op !== 'issueOwned') return defaultRespond(ask);
    const ms = r.plan.bindingsOf(SLUG).find((b) => b.localKind === 'checkpoint');
    return ok({ issue: { id: ask.input['id'], identifier: 'AAA-1', title: created['title'], description: created['description'], teamKey: 'AAA',
      stateType: 'started', projectId: created['projectId'], milestoneId: ms === undefined ? null : created['projectMilestoneId'] ?? null, ...over } });
  };

  it('Linear already reads the planned type: the fingerprint is written and no update is sent', async () => {
    const { r, created, from } = await started();
    r.respond.current = answer(r, created);
    await tick(r);
    expect(opsOf(r, from)).toEqual(['issueOwned']);
    const n = r.asks.length;
    due(r); await tick(r);
    expect(r.asks).toHaveLength(n);                                     // settled
  });

  it('the type agrees but the title differs: the update goes without the state', async () => {
    const { r, created, from } = await started();
    r.respond.current = answer(r, created, { title: 'Edited in Linear' });
    await tick(r);
    expect(opsOf(r, from)).toEqual(['issueOwned', 'issueUpdate']);
    const upd = r.asks[from + 1]!;
    expect('stateId' in upd.input).toBe(false);
    expect(upd.fields).not.toContain('state');
  });

  it('another type: the update goes with the planned state', async () => {
    const { r, created, from } = await started();
    r.respond.current = answer(r, created, { stateType: 'unstarted' });
    await tick(r);
    expect(r.asks.slice(from).find((a) => a.op === 'issueUpdate')!.input['stateId']).toBe(U(22));
  });
});

describe('final-review fixes: a team move (D-8182)', () => {
  /** A bound t2 in project-b (team AAA), then project-b re-keyed to CCC inside the workspace: the next update is a move. */
  async function moving(): Promise<{ r: Rig; t2Binding: () => BindingRow | undefined; linearId: string }> {
    const r = await rig({ extraTeam: true });
    r.plan.applyPlanChanges(SLUG, changes({ tickets: { insert: [ticket('t2', { project: 'project-b' })], update: [], drop: [] } }), OWNER, r.t.now, null);
    await tick(r);
    const t2 = epicRow(r, 'e1').tickets.find((t) => t.key === 't2')!;
    const t2Binding = () => r.plan.bindingsOf(SLUG).find((b) => b.localKind === 'ticket' && b.localId === t2.id);
    r.db.prepare("UPDATE project_linking SET teamKey = 'CCC' WHERE project = 'project-b'").run();
    return { r, t2Binding, linearId: t2Binding()!.linearId! };
  }
  const read = (team: string) => (ask: CcrcOpAsk): CcrcOpOutcome | null =>
    ask.op === 'issueOwned' ? ok({ issue: { id: ask.input['id'], identifier: 'AAA-9', stateType: 'unstarted', teamKey: team } }) : null;

  it('C19: a move whose issue already reads the planned type still sends the state with the move (never state-held)', async () => {
    const { r } = await moving();
    r.respond.current = (ask) => read('AAA')(ask) ?? defaultRespond(ask);
    const from = r.asks.length;
    due(r); await tick(r);
    const upd = r.asks.slice(from).find((a) => a.op === 'issueUpdate')!;
    expect(upd.input['teamId']).toBe(CCC_TEAM.id);
    expect(upd.input['stateId']).toBe(U(31));                          // CCC's own unstarted state goes with the move
    expect(upd.fields).toContain('state');
  });

  it('A10: a team move whose reply was lost: the next read finds the issue moved, and binds its new identifier (§5.5)', async () => {
    const { r, t2Binding } = await moving();
    const created = r.asks.filter((a) => a.op === 'issueCreate').find((a) => a.input['title'] === 'Ticket t2')!.input as Record<string, unknown>;
    r.respond.current = (ask) => (ask.op === 'issueUpdate' ? { ok: false, word: 'timeout', maybeSent: true } : read('AAA')(ask) ?? defaultRespond(ask));
    due(r); await tick(r);                                              // the move is sent; its reply is lost
    expect(r.asks.filter((a) => a.op === 'issueUpdate')).toHaveLength(1);
    r.respond.current = (ask) => (ask.op === 'issueOwned'
      ? ok({ issue: { id: ask.input['id'], identifier: 'CCC-9', stateType: 'unstarted', teamKey: 'CCC', title: created['title'], description: created['description'],
        projectId: created['projectId'], milestoneId: null } })
      : defaultRespond(ask));
    r.t.now += 31_000;
    await tick(r);
    expect(r.asks.filter((a) => a.op === 'issueUpdate')).toHaveLength(1);          // `same`: nothing more is sent
    expect(t2Binding()).toMatchObject({ state: 'bound', identifier: 'CCC-9', teamKey: 'CCC' });
  });

  it('I-2 (C17): a refused team move, requeued, sends one issueUpdate with the move and no create', async () => {
    const { r, t2Binding, linearId } = await moving();
    r.respond.current = (ask) => read('AAA')(ask) ?? (ask.op === 'issueUpdate' ? { ok: false, word: 'policy-denied', maybeSent: false } : defaultRespond(ask));
    due(r); await tick(r);
    expect(t2Binding()).toMatchObject({ state: 'failed', failedWord: 'policy-denied', linearId });
    r.respond.current = (ask) => read('AAA')(ask) ?? (ask.op === 'issueUpdate' ? ok({ id: ask.target, identifier: 'CCC-9' }) : defaultRespond(ask));
    const from = r.asks.length;
    r.t.now += 1_800_000;                                               // past the last backoff step (C10)
    await tick(r);
    const sent = opsOf(r, from);
    expect(sent).not.toContain('issueCreate');
    const moves = r.asks.slice(from).filter((a) => a.op === 'issueUpdate');
    expect(moves).toHaveLength(1);
    expect(moves[0]!.input['teamId']).toBe(CCC_TEAM.id);
    expect(moves[0]!.destinationTeamKey).toBe('CCC');
    expect(t2Binding()).toMatchObject({ state: 'bound', linearId, identifier: 'CCC-9', teamKey: 'CCC' });
  });
});
