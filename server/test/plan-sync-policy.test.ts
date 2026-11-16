// D-8182 (Linear hierarchy plan, Task 3.1): the plan sync's pure deciders. Fixtures use neutral names only.
import { describe, expect, it } from 'vitest';
import type { BindingRow, CheckpointRow, EpicRow, StoredPlan, TicketRow } from '../src/coord/planStore.js';
import {
  plannedFingerprint, fitProjectName, initiativeDescription, LINEAR_PROJECT_NAME_MAX_CHARS, planSyncSteps, requestIdOf, type SyncSnapshot, type SyncStep,
} from '../src/linear/planSyncPolicy.js';
import { LINEAR_INITIATIVE_STATUSES } from '../src/linear/hierarchyOps.js';

const U = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const WS = 'ws-a';
const TEAM = U(1);

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
const bind = (o: Partial<BindingRow> & Pick<BindingRow, 'localKind' | 'localId'>): BindingRow => ({
  id: 100 + o.localId + (o.localKind === 'epic' ? 10 : o.localKind === 'checkpoint' ? 20 : o.localKind === 'ticket' ? 30 : 0), workspaceId: WS, teamKey: 'AAA',
  linearId: U(500 + o.localId), identifier: null, fingerprint: 'stale', syncedAt: 1, state: 'bound', failedAt: null, failedWord: null, failedInputs: null,
  driftCount: 0, driftSince: null, heldItemId: null, ...o,
});
const directory = {
  viewerId: U(9), labels: [], projects: [], users: [], initiatives: 'on' as const,
  states: ['AAA', 'KEY'].flatMap((teamKey, i) => [
    { id: U(21 + i * 10), name: 'Todo', type: 'unstarted', teamKey }, { id: U(22 + i * 10), name: 'Doing', type: 'started', teamKey },
    { id: U(23 + i * 10), name: 'Done', type: 'completed', teamKey }, { id: U(24 + i * 10), name: 'Nope', type: 'canceled', teamKey }]),
  projectStatuses: [{ id: U(31), name: 'P', type: 'planned' }, { id: U(32), name: 'S', type: 'started' },
    { id: U(33), name: 'C', type: 'completed' }, { id: U(34), name: 'X', type: 'canceled' }],
};

function snap(o: { epic?: Partial<EpicRow>; cps?: CheckpointRow[]; tickets?: TicketRow[]; bindings?: BindingRow[]; mode?: 'public' | 'private' | 'unknown';
  initiatives?: 'on' | 'off'; wsInitiatives?: 'on' | 'off' | 'unknown'; dir?: typeof directory | null; teamKey?: string | null; end?: SyncSnapshot['program']['end'];
  extraProjects?: SyncSnapshot['projects'] } = {}): SyncSnapshot {
  const plan: StoredPlan = {
    program: 'prog', planBy: null, required: true,
    epics: [{ ...epic(o.epic), checkpoints: o.cps ?? [], tickets: o.tickets ?? [] }],
  };
  return {
    program: { slug: 'prog', rowid: 7, title: 'The programme', end: o.end ?? null, inShort: 'Short words', doneWhen: [{ text: 'It works', proved: false }] },
    plan, bindings: o.bindings ?? [],
    workspaces: [{ workspaceId: WS, initiatives: o.wsInitiatives ?? 'on', directory: o.dir === undefined ? directory : o.dir, teams: [{ id: TEAM, key: 'AAA' }, { id: U(3), key: 'KEY' }] }],
    projects: [{ project: 'proj-a', teamKey: o.teamKey === undefined ? 'AAA' : o.teamKey, workspaceId: WS, mode: o.mode ?? 'private', initiatives: o.initiatives ?? 'on' },
      ...(o.extraProjects ?? [])],
    privateTrackerKeys: [],
  };
}
const ops = (steps: SyncStep[]): string[] => steps.map((s) => (s.kind === 'skip' ? `skip:${s.why}` : `${s.kind}:${s.op}`));
const boundEpic = (fp = 'stale'): BindingRow => bind({ localKind: 'epic', localId: 1, fingerprint: fp });
type SnapOpts = Parameters<typeof snap>[0];
/** `snap(o)` with the epic's project bound at the fingerprint a first create would have written, so no project step follows. */
function snapBound(o: SnapOpts = {}, extra: BindingRow[] = []): SyncSnapshot {
  const first = planSyncSteps(snap({ ...o, bindings: [] })).steps.find((x) => x.kind === 'create' && x.op === 'projectCreate');
  if (first?.kind !== 'create') throw new Error('no project create');
  return snap({ ...o, bindings: [bind({ localKind: 'epic', localId: 1, fingerprint: first.fingerprint }), ...extra, ...(o?.bindings ?? [])] });
}

describe('planSyncSteps (D-8182)', () => {
  it('a fresh plan yields initiative, projects, milestones, issues in that order', () => {
    const fresh = snap({ cps: [cp()], tickets: [tk()] });
    expect(ops(planSyncSteps(fresh).steps)).toEqual(['create:initiativeCreate', 'create:projectCreate']);
    const withProject = snapBound({ cps: [cp()], tickets: [tk()] });
    const got = ops(planSyncSteps(withProject).steps);
    expect(got.slice(0, 3)).toEqual(['create:initiativeCreate', 'create:projectMilestoneCreate', 'create:issueCreate']);
    const ms = planSyncSteps(withProject).steps.find((s) => s.kind === 'create' && s.op === 'projectMilestoneCreate');
    expect(ms).toMatchObject({ requestId: requestIdOf('checkpoint', 1, WS), recover: 'name-in-project', input: { projectId: U(501), sortOrder: 3 } });
  });

  it('no milestone step until its project is bound', () => {
    const pending = snap({ cps: [cp()], bindings: [bind({ localKind: 'epic', localId: 1, state: 'pending', linearId: null, fingerprint: null })] });
    expect(ops(planSyncSteps(pending).steps)).not.toContain('create:projectMilestoneCreate');
    expect(ops(planSyncSteps(snap({ cps: [cp()] })).steps)).not.toContain('create:projectMilestoneCreate');
  });

  it('initiatives off: no initiative step and the project description names the programme', () => {
    for (const s of [snap({ initiatives: 'off' }), snap({ wsInitiatives: 'off' })]) {
      const { steps } = planSyncSteps(s);
      expect(ops(steps)).toEqual(['skip:initiatives-off', 'create:projectCreate']);
      expect(steps[1]).toMatchObject({ input: { description: expect.stringContaining('Part of The programme.') } });
    }
    const on = planSyncSteps(snap()).steps.find((s) => s.kind === 'create' && s.op === 'projectCreate');
    expect(JSON.stringify(on)).not.toContain('Part of');
  });

  it('a renamed epic yields one project update, a matching fingerprint none', () => {
    const first = planSyncSteps(snap()).steps.find((s) => s.kind === 'create' && s.op === 'projectCreate');
    if (first?.kind !== 'create') throw new Error('no create');
    const settled = snap({ bindings: [boundEpic(first.fingerprint)] });
    expect(ops(planSyncSteps(settled).steps).filter((o) => o.includes('project'))).toEqual([]);
    const renamed = snap({ epic: { title: 'A new name' }, bindings: [boundEpic(first.fingerprint)] });
    const upd = planSyncSteps(renamed).steps.filter((s) => s.kind === 'update');
    expect(upd).toHaveLength(1);
    expect(upd[0]).toMatchObject({ op: 'projectUpdate', input: { id: U(501), name: 'A new name' }, fields: ['name', 'description', 'status', 'teams'] });
  });

  it('a missing status type fails the step, not the pass', () => {
    const dir = { ...directory, projectStatuses: directory.projectStatuses.filter((p) => p.type !== 'started') };
    const { steps } = planSyncSteps(snap({ dir, tickets: [tk()], bindings: [] }));
    expect(ops(steps)).toEqual(['create:initiativeCreate', 'skip:status-missing']);
    const dir2 = { ...directory, states: directory.states.filter((x) => x.type !== 'unstarted') };
    const s2 = planSyncSteps(snapBound({ dir: dir2, cps: [cp()], tickets: [tk()] })).steps;
    expect(ops(s2)).toEqual(['create:initiativeCreate', 'create:projectMilestoneCreate', 'skip:status-missing']);
  });

  it('requestIdOf is stable and v4-shaped', () => {
    const a = requestIdOf('epic', 4, WS);
    expect(a).toBe(requestIdOf('epic', 4, WS));
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a).not.toBe(requestIdOf('epic', 5, WS));
    expect(requestIdOf('epic', 4, WS, 'link')).not.toBe(a);
  });

  it('plannedFingerprint ignores key order', () => {
    expect(plannedFingerprint({ a: 1, b: { c: 2, d: [1, 2] } })).toBe(plannedFingerprint({ b: { d: [1, 2], c: 2 }, a: 1 }));
    expect(plannedFingerprint({ a: 1 })).toMatch(/^[0-9a-f]{16}$/);
    expect(plannedFingerprint({ a: 1 })).not.toBe(plannedFingerprint({ a: 2 }));
  });

  it("a public project's issue text carries no Linear URL and no identifier", () => {
    const s = snapBound({ mode: 'public', tickets: [tk()] });
    const issue = planSyncSteps(s).steps.find((x) => x.kind === 'create' && x.op === 'issueCreate');
    if (issue?.kind !== 'create') throw new Error('no issue step');
    const text = String(issue.input['description']);
    expect(text).toContain('Do the thing');
    expect(text).not.toMatch(/linear\.app|[A-Za-z]+-\d+/);
  });

  it("a public project's ticket whose stored title names KEY-123 is skipped text-public, every other step emitted", () => {
    const s = snapBound({ mode: 'public', teamKey: 'KEY', tickets: [tk({ title: 'Fix KEY-123 now' }), tk({ id: 2, key: 't2', title: 'Fine' })] });
    const steps = planSyncSteps(s).steps;
    expect(ops(steps)).toEqual(['create:initiativeCreate', 'skip:text-public', 'create:issueCreate']);
    expect(steps[1]).toMatchObject({ kind: 'skip', local: { kind: 'ticket', id: 1 } });
    expect(JSON.stringify(steps[1])).not.toContain('KEY-123');
    expect(planSyncSteps(snapBound({ mode: 'private', tickets: [tk({ title: 'Fix KEY-123 now' })] })).steps.map((x) => x.kind)).not.toContain('skip');
  });
});

describe('planSyncSteps rulings (D-8182)', () => {
  it('R4: a project name is fitted to 80 code points, ending with an ellipsis', () => {
    const long = 'x'.repeat(100);
    const fitted = fitProjectName(long);
    expect([...fitted]).toHaveLength(LINEAR_PROJECT_NAME_MAX_CHARS);
    expect(fitted.endsWith('…')).toBe(true);
    expect(fitProjectName('short')).toBe('short');
    expect(fitProjectName(`${'y'.repeat(78)} ${'z'.repeat(20)}`)).toBe(`${'y'.repeat(78)}…`);
    const step = planSyncSteps(snap({ epic: { title: long } })).steps.find((x) => x.kind === 'create' && x.op === 'projectCreate');
    expect(step).toMatchObject({ input: { name: fitted } });
  });

  it('C4: a project created before its initiative is linked by one link step, whose fingerprint settles it', () => {
    const noLink = planSyncSteps(snap()).steps;
    const created = noLink.find((x) => x.kind === 'create' && x.op === 'projectCreate');
    if (created?.kind !== 'create') throw new Error('no create');
    const init = noLink.find((x) => x.kind === 'create' && x.op === 'initiativeCreate');
    if (init?.kind !== 'create') throw new Error('no initiative create');
    const withInit = [boundEpic(created.fingerprint), bind({ localKind: 'programme', localId: 7, linearId: U(700), fingerprint: init.fingerprint })];
    const steps = planSyncSteps(snap({ bindings: withInit })).steps;
    expect(ops(steps)).toEqual(['link:initiativeToProjectCreate']);
    const link = steps[0]!;
    if (link.kind !== 'link') throw new Error('no link');
    expect(link.input).toMatchObject({ initiativeId: U(700), projectId: U(501), requestId: requestIdOf('epic', 1, WS, 'link') });
    const settled = snap({ bindings: [boundEpic(link.fingerprint), withInit[1]!] });
    expect(planSyncSteps(settled).steps).toEqual([]);
  });

  it('C3: a team key with no team id in its workspace is skipped no-team-key; a null key too', () => {
    const s = snap();
    s.workspaces[0]!.teams = [];
    expect(ops(planSyncSteps(s).steps)).toEqual(['skip:no-team-key']);
    expect(ops(planSyncSteps(snap({ teamKey: null })).steps)).toEqual(['skip:no-team-key']);
  });

  it('a ticket whose project sits in another workspace is skipped workspace-mismatch', () => {
    const s = snapBound({ tickets: [tk({ project: 'proj-b' })],
      extraProjects: [{ project: 'proj-b', teamKey: 'BBB', workspaceId: 'ws-b', mode: 'private', initiatives: 'on' }] });
    s.workspaces.push({ workspaceId: 'ws-b', initiatives: 'on', directory, teams: [{ id: U(2), key: 'BBB' }] });
    expect(ops(planSyncSteps(s).steps)).toEqual(['create:initiativeCreate', 'skip:workspace-mismatch']);
  });

  it('a failed binding emits nothing under it and reports the fingerprint of its inputs now', () => {
    const failed = snapBound({ cps: [cp()], tickets: [tk()] }, [bind({ localKind: 'checkpoint', localId: 1, state: 'failed', linearId: null, failedInputs: 'old' })]);
    const r = planSyncSteps(failed);
    expect(ops(r.steps)).toEqual(['create:initiativeCreate', 'create:issueCreate']);
    expect(r.failedInputs).toHaveLength(1);
    const renamed = snap({ cps: [cp({ title: 'Changed' })], tickets: [tk()], bindings: failed.bindings });
    expect(planSyncSteps(renamed).failedInputs[0]!.inputs).not.toBe(r.failedInputs[0]!.inputs);
    expect(planSyncSteps(failed).failedInputs).toEqual(r.failedInputs);
  });

  it('C7 and R6: the initiative status follows the programme', () => {
    const status = (s: SyncSnapshot): unknown => (planSyncSteps(s).steps[0] as { input: Record<string, unknown> }).input['status'];
    expect(status(snap({ epic: { state: 'planned' } }))).toBe('Planned');
    expect(status(snap())).toBe('Active');
    expect(status(snap({ end: { outcome: 'done', why: null, at: Date.UTC(2026, 10, 3) } }))).toBe('Completed');
    const ab = snap({ end: { outcome: 'abandoned', why: 'no longer needed', at: Date.UTC(2026, 10, 3) } });
    expect(status(ab)).toBe('Canceled');
    expect(initiativeDescription(ab)).toContain('Abandoned on 2026-11-03: no longer needed');
    expect(LINEAR_INITIATIVE_STATUSES).toContain('Canceled');
  });

  it('a met checkpoint states the met line and its target date; state is by type', () => {
    const met = cp({ state: 'met', metAt: Date.UTC(2026, 10, 5), evidence: { pr: 42 } });
    const steps = planSyncSteps(snap({ epic: { state: 'done' }, cps: [met], tickets: [tk({ state: 'started' })], bindings: [boundEpic()] })).steps;
    const m = steps.find((x) => x.kind === 'create' && x.op === 'projectMilestoneCreate');
    expect(m).toMatchObject({ input: { targetDate: '2026-11-05', description: expect.stringContaining('Met on 2026-11-05: PR #42') } });
    expect(steps.find((x) => x.kind === 'create' && x.op === 'issueCreate')).toMatchObject({ input: { stateId: U(22) } });
    expect(steps.find((x) => x.kind === 'update')).toMatchObject({ op: 'projectUpdate', input: { statusId: U(33) } });
  });
});
