// D-8182 (Linear hierarchy plan, Task 3.1): the plan sync's pure deciders. Fixtures use neutral names only.
import { describe, expect, it } from 'vitest';
import type { BindingRow, CheckpointRow, EpicRow, StoredPlan, TicketRow } from '../src/coord/planStore.js';
import {
  adoptionVerdict, deferralOf, directoryMissed, directoryWaitVerdict, DIRECTORY_EPISODE_REFILLS, issueReadVerdict, nextDirectoryStreak, probeWaitsVerdict, plannedFingerprint, withoutPutBack, fitProjectName, initiativeDescription, LINEAR_PROJECT_NAME_MAX_CHARS, planSyncSteps,
  requeueVerdict, requestIdOf, type AdoptionKind, type DeferCause, type Deferral, type AdoptionNode, type SyncSnapshot, type SyncStep,
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

describe('final-review rulings: the pure verdicts (D-8182)', () => {
  const RID = requestIdOf('epic', 1, WS);
  const VIEWER = U(9);
  const NONE = new Set<string>();
  const ask = (o: { viewer?: string | null; teamKey?: string | null; held?: ReadonlySet<string> } = {}) => ({
    requestId: RID, viewer: o.viewer === undefined ? VIEWER : o.viewer, teamKey: o.teamKey === undefined ? 'AAA' : o.teamKey, held: o.held ?? NONE,
  });
  const ROWS: { name: string; kind: AdoptionKind; nodes: AdoptionNode[]; a?: Parameters<typeof ask>[0]; adopt: boolean }[] = [
    { name: "C2': an initiative at the requestId made by this key", kind: 'initiative', nodes: [{ id: RID, creatorId: VIEWER }], adopt: true },
    { name: 'I-1: an initiative at the requestId made by another creator', kind: 'initiative', nodes: [{ id: RID, creatorId: U(901) }], adopt: false },
    { name: "C-2: a same-named initiative of this key at another id (another programme's)", kind: 'initiative', nodes: [{ id: U(77), creatorId: VIEWER }], adopt: false },
    { name: 'an initiative with no creator answered', kind: 'initiative', nodes: [{ id: RID, creatorId: null }], adopt: false },
    { name: 'no viewer known: nothing is provably ours', kind: 'initiative', nodes: [{ id: RID, creatorId: VIEWER }], a: { viewer: null }, adopt: false },
    { name: 'an object another binding holds', kind: 'initiative', nodes: [{ id: RID, creatorId: VIEWER }], a: { held: new Set([RID]) }, adopt: false },
    { name: 'a project at the requestId, this key, in the team', kind: 'project', nodes: [{ id: RID, creatorId: VIEWER, teamKeys: ['AAA'] }], a: { teamKey: 'aaa' }, adopt: true },
    { name: 'a project at the requestId outside the team', kind: 'project', nodes: [{ id: RID, creatorId: VIEWER, teamKeys: ['BBB'] }], adopt: false },
    { name: "C-2: another programme's same-named project in the team", kind: 'project', nodes: [{ id: U(78), creatorId: VIEWER, teamKeys: ['AAA'] }], adopt: false },
    { name: 'I-1: a project at the requestId made by another creator', kind: 'project', nodes: [{ id: RID, creatorId: U(901), teamKeys: ['AAA'] }], adopt: false },
    { name: "C2': a milestone at the requestId", kind: 'milestone', nodes: [{ id: U(5) }, { id: RID }], a: { viewer: null }, adopt: true },
    { name: "C2': a milestone of the same name at another id", kind: 'milestone', nodes: [{ id: U(5) }], adopt: false },
    { name: 'a milestone another binding holds', kind: 'milestone', nodes: [{ id: RID }], a: { held: new Set([RID]) }, adopt: false },
    { name: 'C11: an issue at the requestId in the planned team', kind: 'issue', nodes: [{ id: RID, teamKey: 'aaa' }], adopt: true },
    { name: 'C11: an issue at the requestId in another team', kind: 'issue', nodes: [{ id: RID, teamKey: 'BBB' }], adopt: false },
    { name: 'C11: an issue that answers no team', kind: 'issue', nodes: [{ id: RID }], adopt: false },
    { name: 'C11: an issue with no planned team', kind: 'issue', nodes: [{ id: RID, teamKey: 'AAA' }], a: { teamKey: null }, adopt: false },
    { name: 'C11: an issue another binding holds', kind: 'issue', nodes: [{ id: RID, teamKey: 'AAA' }], a: { held: new Set([RID]) }, adopt: false },
  ];
  it.each(ROWS)('adoptionVerdict: $name', (row) => {
    expect(adoptionVerdict(row.kind, row.nodes, ask(row.a))).toEqual(row.adopt ? { verdict: 'adopt', id: RID } : { verdict: 'none' });
  });

  const step = { stateType: 'started', teamKey: 'AAA', input: { title: 'T', description: 'D', projectId: U(501), projectMilestoneId: null } };
  const issue = { stateType: 'started', title: 'T', description: 'D\n', teamKey: 'aaa', projectId: U(501), milestoneId: null };
  const READS: { name: string; over: Record<string, unknown>; verdict: 'same' | 'state-held' | 'send' }[] = [
    { name: 'everything planned already reads in Linear (C12)', over: {}, verdict: 'same' },
    { name: 'the type agrees, the title differs (C12)', over: { title: 'Edited' }, verdict: 'state-held' },
    { name: 'another type (C12)', over: { stateType: 'unstarted' }, verdict: 'send' },
    { name: 'C19: the type agrees but the issue is in another team (a move)', over: { teamKey: 'CCC' }, verdict: 'send' },
    { name: 'C19: the type agrees but the issue answers no team', over: { teamKey: undefined }, verdict: 'send' },
  ];
  it.each(READS)('issueReadVerdict: $name', (row) => {
    expect(issueReadVerdict({ ...issue, ...row.over }, step)).toBe(row.verdict);
  });

  const failed = (o: Partial<BindingRow> = {}): BindingRow => bind({ localKind: 'epic', localId: 1, state: 'failed', failedAt: 1_000, failedInputs: 'in-1', ...o });
  const REQUEUES: { name: string; b: BindingRow; why: Parameters<typeof requeueVerdict>[1]; verdict: 'stay' | 'to-bound' | 'to-pending' }[] = [
    { name: 'a bound binding stays', b: bind({ localKind: 'epic', localId: 1 }), why: { kind: 'time', filledAt: 5_000, olderThan: 5_000 }, verdict: 'stay' },
    { name: 'C10: a refresh after the failure, never created: back to pending', b: failed({ linearId: null }), why: { kind: 'time', filledAt: 2_000, olderThan: 0 }, verdict: 'to-pending' },
    { name: 'C17: a refresh after the failure, an object known: back to bound', b: failed(), why: { kind: 'time', filledAt: 2_000, olderThan: 0 }, verdict: 'to-bound' },
    { name: 'C10: past the last backoff step', b: failed(), why: { kind: 'time', filledAt: null, olderThan: 1_001 }, verdict: 'to-bound' },
    { name: 'C10: a refresh before the failure and inside the backoff', b: failed(), why: { kind: 'time', filledAt: 999, olderThan: 1_000 }, verdict: 'stay' },
    { name: 'C10: no failure time', b: failed({ failedAt: null }), why: { kind: 'time', filledAt: 2_000, olderThan: 5_000 }, verdict: 'stay' },
    { name: 'C10: the same inputs', b: failed(), why: { kind: 'inputs', inputs: 'in-1' }, verdict: 'stay' },
    { name: 'C10+C17: changed inputs, an object known', b: failed(), why: { kind: 'inputs', inputs: 'in-2' }, verdict: 'to-bound' },
    { name: 'C10: changed inputs, never created', b: failed({ linearId: null }), why: { kind: 'inputs', inputs: 'in-2' }, verdict: 'to-pending' },
  ];
  it.each(REQUEUES)('requeueVerdict: $name', (row) => {
    expect(requeueVerdict(row.b, row.why)).toBe(row.verdict);
  });

  it("C16: a PR link step's inputs are the inputs the issue's binding reports when failed", () => {
    const base = snapBound({ tickets: [tk()] });
    const create = planSyncSteps(base).steps.find((x) => x.kind === 'create' && x.op === 'issueCreate');
    if (create?.kind !== 'create') throw new Error('no issue create');
    const pr = { 1: { url: 'https://github.com/owner/repo/pull/7', number: 7, branch: null } };
    const bound = bind({ localKind: 'ticket', localId: 1, identifier: 'AAA-1', fingerprint: create.fingerprint });
    const linked = { ...snapBound({ tickets: [tk()] }, [bound]), ticketPrs: pr };
    const link = planSyncSteps(linked).steps.find((x) => x.kind === 'link' && x.op === 'issueLink');
    if (link?.kind !== 'link') throw new Error('no link');
    const asFailed = { ...snapBound({ tickets: [tk()] }, [{ ...bound, state: 'failed' as const, failedAt: 1, failedInputs: 'x' }]), ticketPrs: pr };
    expect(planSyncSteps(asFailed).failedInputs.find((f) => f.bindingId === bound.id)!.inputs).toBe(link.inputs);
  });
});

describe('fix round 1 (D-8182): the initiatives probe and the directory', () => {
  it('D-8701: a directory is a miss when none is held or its statuses were never read; a read empty list is no miss', () => {
    expect(directoryMissed(null, null)).toBe(true);
    expect(directoryMissed(directory, 'unread')).toBe(true);
    expect(directoryMissed(directory, null)).toBe(true);
    expect(directoryMissed({ ...directory, projectStatuses: [] }, 'read')).toBe(false);
    expect(directoryMissed(directory, 'read')).toBe(false);
  });

  it('a probe answering unknown defers the initiative: no step, and the workspace waits; the projects still go', () => {
    const r = planSyncSteps(snap({ wsInitiatives: 'unknown' }));
    expect(ops(r.steps)).toEqual(['create:projectCreate']);
    expect(r.waits).toEqual([WS]);
    expect(planSyncSteps(snap()).waits).toEqual([]);
    expect(planSyncSteps(snap({ wsInitiatives: 'off' })).waits).toEqual([]);         // off is a statement, nothing to wait for
    expect(planSyncSteps(snap({ wsInitiatives: 'unknown', initiatives: 'off' })).waits).toEqual([]);
  });

  /** A settled programme: its initiative and project bound and linked, at the fingerprints a first sync wrote. */
  function linked(): BindingRow[] {
    const created = planSyncSteps(snap()).steps;
    const init = created.find((x) => x.kind === 'create' && x.op === 'initiativeCreate');
    const proj = created.find((x) => x.kind === 'create' && x.op === 'projectCreate');
    if (init?.kind !== 'create' || proj?.kind !== 'create') throw new Error('no creates');
    const ib = bind({ localKind: 'programme', localId: 7, linearId: U(700), fingerprint: init.fingerprint });
    const link = planSyncSteps(snap({ bindings: [boundEpic(proj.fingerprint), ib] })).steps[0];
    if (link?.kind !== 'link') throw new Error('no link');
    return [boundEpic(link.fingerprint), ib];
  }

  it('a probe answering unknown keeps the projects linked: nothing is sent and nothing waits for a current initiative', () => {
    const r = planSyncSteps(snap({ wsInitiatives: 'unknown', bindings: linked() }));
    expect(r.steps).toEqual([]);
    expect(r.waits).toEqual([]);
  });

  it('A3: a failed initiative that has a Linear object keeps its projects linked: no projectUpdate, no second link', () => {
    const [eb, ib] = linked();
    const failed = { ...ib!, state: 'failed' as const, failedAt: 1, failedWord: 'linear-forbidden', failedInputs: 'x' };
    expect(planSyncSteps(snap({ bindings: [eb!, failed] })).steps).toEqual([]);
    // a project created while the initiative is failed is not linked to it, and is not sent again and again either
    const proj = planSyncSteps(snap()).steps.find((x) => x.kind === 'create' && x.op === 'projectCreate');
    if (proj?.kind !== 'create') throw new Error('no create');
    expect(planSyncSteps(snap({ bindings: [boundEpic(proj.fingerprint), failed] })).steps).toEqual([]);
  });
});

describe('fix round 1 (D-8182): put back', () => {
  it('F5: withoutPutBack leaves out every epic, checkpoint and ticket whose putBackAt is set, and nothing else', () => {
    const plan: StoredPlan = { program: 'prog', planBy: null, required: true, epics: [
      { ...epic(), checkpoints: [cp(), cp({ id: 2, key: 'c2', putBackAt: 5 })], tickets: [tk(), tk({ id: 2, key: 't2', putBackAt: 5 })] },
      { ...epic({ id: 2, key: 'e2', putBackAt: 5 }), checkpoints: [], tickets: [] },
    ] };
    const kept = withoutPutBack(plan);
    expect(kept.epics.map((e) => e.id)).toEqual([1]);
    expect(kept.epics[0]!.checkpoints.map((c) => c.id)).toEqual([1]);
    expect(kept.epics[0]!.tickets.map((t) => t.id)).toEqual([1]);
    expect(plan.epics).toHaveLength(2);                                   // pure: the input is untouched
  });
});

describe('M5: what a deferral is (L1, D-8182)', () => {
  // A `failure` holds its backoff against later marks (A7/A12); a `wait` is ordinary. `backoff` waits the escalating step,
  // `directory` the short wait for a fill, `until` a time the cause carries (a refused key's block).
  const ROWS: [DeferCause, Deferral][] = [
    ['rate-limited', { why: 'failure', wait: 'backoff' }],
    ['unreachable', { why: 'failure', wait: 'backoff' }],
    ['timeout', { why: 'failure', wait: 'backoff' }],
    ['policy-unavailable', { why: 'failure', wait: 'backoff' }],
    ['journal-unavailable', { why: 'failure', wait: 'backoff' }],
    ['malformed', { why: 'failure', wait: 'backoff' }],
    ['linear-unauthorised', { why: 'failure', wait: 'backoff' }],
    ['store-unreadable', { why: 'failure', wait: 'backoff' }],
    ['created-without-id', { why: 'failure', wait: 'backoff' }],
    ['workspace-blocked', { why: 'failure', wait: 'until' }],
    ['directory-missing', { why: 'wait', wait: 'directory' }],
    ['viewer-unknown', { why: 'wait', wait: 'directory' }],
    ['initiatives-unknown', { why: 'wait', wait: 'backoff' }],
    ['statuses-unread', { why: 'wait', wait: 'backoff' }],             // I1: escalates, never every 10 s
  ];
  it.each(ROWS)('deferralOf(%s)', (cause, d) => { expect(deferralOf(cause)).toEqual(d); });
});

describe('D-8701 episodes: bounded waits (coordinator ruling, mail 22220; I1)', () => {
  const DIG = 'digest-a';
  it('a streak counts each new fill that reads unsettled, from the first; a settled fill ends it; no fill changes nothing', () => {
    expect(DIRECTORY_EPISODE_REFILLS).toBe(3);
    let st = nextDirectoryStreak(undefined, { keyDigest: DIG, filledAt: 100, reading: 'unsettled' });
    expect(st).toEqual({ keyDigest: DIG, since: 100, lastFilledAt: 100, refills: 1 });
    expect(nextDirectoryStreak(st, { keyDigest: DIG, filledAt: 100, reading: 'unsettled' })).toBe(st);   // the same fill again
    st = nextDirectoryStreak(st, { keyDigest: DIG, filledAt: 200, reading: 'unsettled' });
    expect(st).toMatchObject({ since: 100, refills: 2 });
    expect(nextDirectoryStreak(st, { keyDigest: DIG, filledAt: null, reading: 'none' })).toBe(st);
    expect(nextDirectoryStreak(st, { keyDigest: DIG, filledAt: 300, reading: 'settled' })).toBeUndefined();   // the episode ends
    expect(nextDirectoryStreak(st, { keyDigest: 'digest-b', filledAt: 300, reading: 'unsettled' })).toEqual({ keyDigest: 'digest-b', since: 300, lastFilledAt: 300, refills: 1 });
  });

  const streak = (refills: number) => ({ keyDigest: DIG, since: 1, lastFilledAt: refills, refills });
  it('the probe: a workspace waits until its streak reaches the bound, then the pass settles without it and tells', () => {
    const of = new Map([['ws-1', streak(2)], ['ws-2', streak(3)], ['ws-3', streak(7)]]);
    expect(probeWaitsVerdict(['ws-1', 'ws-2', 'ws-3', 'ws-4'], (ws) => of.get(ws))).toEqual({ waitOn: ['ws-1', 'ws-4'], bounded: ['ws-2', 'ws-3'] });
    expect(probeWaitsVerdict([], () => undefined)).toEqual({ waitOn: [], bounded: [] });
  });

  it('unread statuses: wait on the backoff (a missing directory on the short wait), and tell once the bound is reached', () => {
    expect(directoryWaitVerdict([{ workspaceId: 'ws-1', missing: 'statuses', streak: streak(1) }])).toEqual({ cause: 'statuses-unread', tell: [] });
    expect(directoryWaitVerdict([{ workspaceId: 'ws-1', missing: 'statuses', streak: streak(3) }, { workspaceId: 'ws-2', missing: 'statuses', streak: undefined }]))
      .toEqual({ cause: 'statuses-unread', tell: ['ws-1'] });
    expect(directoryWaitVerdict([{ workspaceId: 'ws-1', missing: 'statuses', streak: streak(3) }, { workspaceId: 'ws-2', missing: 'directory', streak: undefined }]))
      .toEqual({ cause: 'directory-missing', tell: ['ws-1'] });
  });
});
