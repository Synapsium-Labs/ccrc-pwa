// D-8182 (Linear hierarchy plan, Task 3.1): the plan sync's pure deciders. Fixtures use neutral names only.
import { describe, expect, it } from 'vitest';
import type { BindingRow, CheckpointRow, EpicRow, StoredPlan, TicketRow } from '../src/coord/planStore.js';
import {
  adoptionVerdict, deferralOf, deferralUntil, deferralUsesBackoff, dispatchWaitVerdict, probeEpisodeText, probeRecheckDue, directoryMissed, directoryWaitVerdict, DIRECTORY_EPISODE_REFILLS, issueReadVerdict, nextDirectoryStreak, probeWaitsVerdict, plannedFingerprint, withoutPutBack, fitProjectName, initiativeDescription, LINEAR_PROJECT_NAME_MAX_CHARS, planSyncSteps,
  requeueVerdict, requestIdOf, uuidOf, linkMarkOf, withLinkMark, textFactsOf, textRefusalOf, textFactOfTeam, type AdoptionKind, type DeferCause, type Deferral, type AdoptionNode, type ProgrammeSnapshot, type SyncSnapshot, type SyncStep,
} from '../src/linear/planSyncPolicy.js';
import { givenUpReason, givenUpWord, inboundActVerdict, inboundHeld, keyWaitMail } from '../src/linear/inboundPolicy.js';
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
  initiatives?: 'on' | 'off'; wsInitiatives?: 'on' | 'off' | 'unknown'; dir?: typeof directory | null; teamKey?: string | null; end?: ProgrammeSnapshot['program']['end'];
  extraProjects?: SyncSnapshot['projects'] } = {}): ProgrammeSnapshot {
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
function snapBound(o: SnapOpts = {}, extra: BindingRow[] = []): ProgrammeSnapshot {
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
  const ask = (o: { viewer?: string | null; held?: ReadonlySet<string> } = {}) => ({
    requestId: RID, viewer: o.viewer === undefined ? VIEWER : o.viewer, held: o.held ?? NONE,
  });
  // D-8183 (round 1 A11): a project (made by this key) and an issue are ours by their id alone, whatever team they sit in now (the
  // team key may have changed between a lost create reply and the recovery); the verdict answers the issue's actual team, so the
  // binding records it and the next pass's update moves the issue.
  const ROWS: { name: string; kind: AdoptionKind; nodes: AdoptionNode[]; a?: Parameters<typeof ask>[0]; adopt: boolean; team?: string }[] = [
    { name: "C2': an initiative at the requestId made by this key", kind: 'initiative', nodes: [{ id: RID, creatorId: VIEWER }], adopt: true },
    { name: 'I-1: an initiative at the requestId made by another creator', kind: 'initiative', nodes: [{ id: RID, creatorId: U(901) }], adopt: false },
    { name: "C-2: a same-named initiative of this key at another id (another programme's)", kind: 'initiative', nodes: [{ id: U(77), creatorId: VIEWER }], adopt: false },
    { name: 'an initiative with no creator answered', kind: 'initiative', nodes: [{ id: RID, creatorId: null }], adopt: false },
    { name: 'no viewer known: nothing is provably ours', kind: 'initiative', nodes: [{ id: RID, creatorId: VIEWER }], a: { viewer: null }, adopt: false },
    { name: 'an object another binding holds', kind: 'initiative', nodes: [{ id: RID, creatorId: VIEWER }], a: { held: new Set([RID]) }, adopt: false },
    { name: 'a project at the requestId, this key, in the team', kind: 'project', nodes: [{ id: RID, creatorId: VIEWER, teamKeys: ['AAA'] }], adopt: true },
    { name: 'A11: a project at the requestId made by this key, in another team now', kind: 'project', nodes: [{ id: RID, creatorId: VIEWER, teamKeys: ['BBB'] }], adopt: true },
    { name: "C-2: another programme's same-named project in the team", kind: 'project', nodes: [{ id: U(78), creatorId: VIEWER, teamKeys: ['AAA'] }], adopt: false },
    { name: 'I-1: a project at the requestId made by another creator', kind: 'project', nodes: [{ id: RID, creatorId: U(901), teamKeys: ['AAA'] }], adopt: false },
    { name: "C2': a milestone at the requestId", kind: 'milestone', nodes: [{ id: U(5) }, { id: RID }], a: { viewer: null }, adopt: true },
    { name: "C2': a milestone of the same name at another id", kind: 'milestone', nodes: [{ id: U(5) }], adopt: false },
    { name: 'a milestone another binding holds', kind: 'milestone', nodes: [{ id: RID }], a: { held: new Set([RID]) }, adopt: false },
    { name: 'C11: an issue at the requestId, held by no other binding: its team is answered', kind: 'issue', nodes: [{ id: RID, teamKey: 'aaa' }], adopt: true, team: 'aaa' },
    { name: 'A11: an issue at the requestId in another team than planned', kind: 'issue', nodes: [{ id: RID, teamKey: 'BBB' }], adopt: true, team: 'BBB' },
    { name: 'A11: an issue that answers no team is adopted with no team', kind: 'issue', nodes: [{ id: RID }], adopt: true },
    { name: 'C11: an issue another binding holds', kind: 'issue', nodes: [{ id: RID, teamKey: 'AAA' }], a: { held: new Set([RID]) }, adopt: false },
  ];
  it.each(ROWS)('adoptionVerdict: $name', (row) => {
    expect(adoptionVerdict(row.kind, row.nodes, ask(row.a))).toEqual(row.adopt ? { verdict: 'adopt', id: RID, ...(row.team === undefined ? {} : { teamKey: row.team }) } : { verdict: 'none' });
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

  // ── D-8183 carried items 8 and 9: the link mark rides the stored fingerprint (still no link row, D-8677) ──
  /** The bindings after a step's ok: its fingerprint stored on its binding. */
  const after = (bindings: BindingRow[], st: SyncStep): BindingRow[] =>
    bindings.map((b) => (st.kind === 'update' || st.kind === 'link') && b.id === st.bindingId ? { ...b, fingerprint: st.fingerprint } : b);

  it('withLinkMark and linkMarkOf: a fingerprint is <base> or <base>+<mark>', () => {
    expect(withLinkMark('abc', null)).toBe('abc');
    expect(withLinkMark('abc', 'def')).toBe('abc+def');
    expect(linkMarkOf('abc+def')).toEqual({ base: 'abc', mark: 'def' });
    expect(linkMarkOf('abc')).toEqual({ base: 'abc', mark: null });
    expect(linkMarkOf('adopted')).toEqual({ base: 'adopted', mark: null });
    expect(linkMarkOf(null)).toEqual({ base: null, mark: null });
  });

  it('an update of a linked project sends no second link', () => {
    const [eb, ib] = linked();
    const upd = planSyncSteps(snap({ epic: { title: 'A new name' }, bindings: [eb!, ib!] })).steps;
    expect(ops(upd)).toEqual(['update:projectUpdate']);                           // one update, and the link stands: no second link
    const settled = after([eb!, ib!], upd[0]!);
    expect(planSyncSteps(snap({ epic: { title: 'A new name' }, bindings: settled })).steps).toEqual([]);
  });

  it('a failed initiative sends its linked projects no update, and a project updated meanwhile sends no link when it binds again', () => {
    const [eb, ib] = linked();
    const failed = { ...ib!, state: 'failed' as const, failedAt: 1, failedWord: 'linear-forbidden', failedInputs: 'x' };
    expect(planSyncSteps(snap({ bindings: [eb!, failed] })).steps).toEqual([]);   // the failure itself changes nothing of the project
    const upd = planSyncSteps(snap({ epic: { title: 'A new name' }, bindings: [eb!, failed] })).steps;
    expect(ops(upd)).toEqual(['update:projectUpdate']);                           // the plan changed: one update, keeping the link mark
    const settled = after([eb!, failed], upd[0]!);
    expect(planSyncSteps(snap({ epic: { title: 'A new name' }, bindings: settled })).steps).toEqual([]);
    expect(planSyncSteps(snap({ epic: { title: 'A new name' }, bindings: [settled[0]!, ib!] })).steps).toEqual([]);   // bound again: still linked
  });

  it('a project created while the initiative is live is linked once, however often it is updated after', () => {
    const created = planSyncSteps(snap()).steps;
    const init = created.find((x) => x.kind === 'create' && x.op === 'initiativeCreate');
    if (init?.kind !== 'create') throw new Error('no initiative create');
    const ib = bind({ localKind: 'programme', localId: 7, linearId: U(700), fingerprint: init.fingerprint });
    const make = planSyncSteps(snap({ bindings: [ib] })).steps;
    expect(ops(make)).toEqual(['create:projectCreate']);
    const proj = make[0]!;
    if (proj.kind !== 'create') throw new Error('no project create');
    let bindings = [boundEpic(proj.fingerprint), ib];
    const link = planSyncSteps(snap({ bindings })).steps;
    expect(ops(link)).toEqual(['link:initiativeToProjectCreate']);
    bindings = after(bindings, link[0]!);
    expect(planSyncSteps(snap({ bindings })).steps).toEqual([]);
    for (const title of ['Renamed once', 'Renamed twice']) {
      const next = planSyncSteps(snap({ epic: { title }, bindings })).steps;
      expect(ops(next)).toEqual(['update:projectUpdate']);
      bindings = after(bindings, next[0]!);
      expect(planSyncSteps(snap({ epic: { title }, bindings })).steps).toEqual([]);
    }
  });

  it('a project whose stored fingerprint is wave 3\'s (no mark) reads not current once: one update, then one link (answered conflict in Linear)', () => {
    const [eb, ib] = linked();
    const old = { ...eb!, fingerprint: 'wave3-encoding' };
    const upd = planSyncSteps(snap({ bindings: [old, ib!] })).steps;
    expect(ops(upd)).toEqual(['update:projectUpdate']);
    const afterUpdate = [...after([old], upd[0]!), ib!];
    const link = planSyncSteps(snap({ bindings: afterUpdate })).steps;
    expect(ops(link)).toEqual(['link:initiativeToProjectCreate']);
    expect(planSyncSteps(snap({ bindings: [...after([afterUpdate[0]!], link[0]!), ib!] })).steps).toEqual([]);
  });

  it('a project linked to another initiative than the live one is linked to the live one, once', () => {
    const [eb, ib] = linked();
    const other = { ...ib!, linearId: U(799) };
    const link = planSyncSteps(snap({ bindings: [eb!, other] })).steps;
    expect(ops(link)).toEqual(['link:initiativeToProjectCreate']);
    expect(planSyncSteps(snap({ bindings: [...after([eb!], link[0]!), other] })).steps).toEqual([]);
  });

  it('the drift pass reads the same rule: a project is current when its base matches and (the initiative is not live, or its mark is the live one\'s)', () => {
    const currentOf = (bindings: BindingRow[]): boolean | undefined => planSyncSteps(snap({ bindings })).owned.find((o) => o.kind === 'project')?.current;
    const [eb, ib] = linked();
    expect(currentOf([eb!, ib!])).toBe(true);
    expect(currentOf([eb!, { ...ib!, linearId: U(799) }])).toBe(false);                    // linked to another initiative than the live one
    expect(currentOf([{ ...eb!, fingerprint: 'wave3-encoding' }, ib!])).toBe(false);       // the base differs
    const base = linkMarkOf(eb!.fingerprint).base!;
    expect(currentOf([{ ...eb!, fingerprint: base }, ib!])).toBe(false);                   // no mark yet while the initiative is live: the link waits
    expect(currentOf([{ ...eb!, fingerprint: base }, { ...ib!, state: 'failed' as const, failedAt: 1, failedWord: 'x', failedInputs: 'x' }])).toBe(true);   // not live: the base is enough
  });

  // ── item 9: the issue's PR link, by the same mark ──
  function boundTicket(): { bound: BindingRow; withPr: (b: BindingRow, url: string | null, title?: string) => SyncSnapshot } {
    const base = snapBound({ tickets: [tk()] });
    const create = planSyncSteps(base).steps.find((x) => x.kind === 'create' && x.op === 'issueCreate');
    if (create?.kind !== 'create') throw new Error('no issue create');
    const bound = bind({ localKind: 'ticket', localId: 1, identifier: 'AAA-1', fingerprint: create.fingerprint });
    return {
      bound,
      withPr: (b, url, title) => ({
        ...snapBound({ tickets: [tk(title === undefined ? {} : { title })] }, [b]),
        ...(url === null ? {} : { ticketPrs: { 1: { url, number: Number(url.split('/').pop()), branch: null } } }),
      }),
    };
  }
  const PR7 = 'https://github.com/owner/repo/pull/7';
  const PR8 = 'https://github.com/owner/repo/pull/8';

  it('a pass with no PR known sends no update and no second link', () => {
    const { bound, withPr } = boundTicket();
    const link = planSyncSteps(withPr(bound, PR7)).steps.find((x) => x.kind === 'link' && x.op === 'issueLink');
    if (link?.kind !== 'link') throw new Error('no link');
    const linked7 = after([bound], link)[0]!;
    expect(planSyncSteps(withPr(linked7, PR7)).steps.filter((x) => x.kind !== 'create')).toEqual([]);           // linked: settled
    expect(planSyncSteps(withPr(linked7, null)).steps.filter((x) => x.kind !== 'create')).toEqual([]);          // no PR known this pass: nothing
    expect(planSyncSteps(withPr(linked7, PR7)).steps.filter((x) => x.kind !== 'create')).toEqual([]);           // known again: no second link
  });

  it('a new PR URL is linked once; an update keeps the mark', () => {
    const { bound, withPr } = boundTicket();
    const l7 = planSyncSteps(withPr(bound, PR7)).steps.find((x) => x.kind === 'link');
    if (l7?.kind !== 'link') throw new Error('no link');
    let b = after([bound], l7)[0]!;
    const l8 = planSyncSteps(withPr(b, PR8)).steps.filter((x) => x.kind !== 'create');
    expect(ops(l8)).toEqual(['link:issueLink']);
    expect(l8[0]).toMatchObject({ input: { url: PR8 } });
    b = after([b], l8[0]!)[0]!;
    expect(planSyncSteps(withPr(b, PR8)).steps.filter((x) => x.kind !== 'create')).toEqual([]);
    const upd = planSyncSteps(withPr(b, PR8, 'A new title')).steps.filter((x) => x.kind !== 'create');
    expect(ops(upd)).toEqual(['update:issueUpdate']);                                                            // the plan changed: one update, no second link
    b = after([b], upd[0]!)[0]!;
    expect(planSyncSteps(withPr(b, PR8, 'A new title')).steps.filter((x) => x.kind !== 'create')).toEqual([]);
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

describe('D-8183 carried item 7: three decisions that were in the executor, now pure', () => {
  const dstreak = { keyDigest: 'digest-a', since: 1, lastFilledAt: 500, refills: 3 };
  it('probeRecheckDue: a settled probe is looked at again once its workspace was refilled since, or the episode ended', () => {
    expect(probeRecheckDue(undefined, 500)).toBe(true);                    // the episode ended
    expect(probeRecheckDue(undefined, null)).toBe(true);
    expect(probeRecheckDue(dstreak, 500)).toBe(false);                     // the same fill: nothing new
    expect(probeRecheckDue(dstreak, null)).toBe(false);                    // no fill held
    expect(probeRecheckDue(dstreak, 501)).toBe(true);                      // refilled since
  });

  it('dispatchWaitVerdict: bound goes first; a held programme or workspace goes without; else wait', () => {
    const base = { identifier: null, programmeHeldUntil: null, workspaceHeld: false, now: 1000 };
    expect(dispatchWaitVerdict({ ...base, identifier: 'AAA-1' })).toBe('bound');
    expect(dispatchWaitVerdict({ ...base, identifier: 'AAA-1', programmeHeldUntil: 2000, workspaceHeld: true })).toBe('bound');
    expect(dispatchWaitVerdict({ ...base, programmeHeldUntil: 1001 })).toBe('go-without');
    expect(dispatchWaitVerdict({ ...base, programmeHeldUntil: 1000 })).toBe('wait');   // the hold has passed
    expect(dispatchWaitVerdict({ ...base, workspaceHeld: true })).toBe('go-without');
    expect(dispatchWaitVerdict(base)).toBe('wait');
  });

  it('deferralUntil: the backoff step (at least the floor), the short directory wait, or the time the cause carries', () => {
    const o = { now: 1000, backoffMs: 30_000, directoryWaitMs: 10_000 };
    expect(deferralUntil({ why: 'failure', wait: 'backoff' }, o)).toBe(31_000);
    expect(deferralUntil({ why: 'failure', wait: 'backoff' }, { ...o, floorMs: 300_000 })).toBe(301_000);
    expect(deferralUntil({ why: 'failure', wait: 'backoff' }, { ...o, floorMs: 5 })).toBe(31_000);
    expect(deferralUntil({ why: 'wait', wait: 'directory' }, o)).toBe(11_000);
    expect(deferralUntil({ why: 'failure', wait: 'until' }, { ...o, until: 9000 })).toBe(9000);
    expect(deferralUntil({ why: 'failure', wait: 'until' }, o)).toBe(31_000);
    expect(deferralUsesBackoff({ why: 'failure', wait: 'backoff' })).toBe(true);
    expect(deferralUsesBackoff({ why: 'wait', wait: 'directory' })).toBe(false);
    expect(deferralUsesBackoff({ why: 'failure', wait: 'until' })).toBe(false);
  });
});

describe('D-8183 carried item 10: the probe mail says what waits', () => {
  const base = { slug: 'prog-a', workspaceId: 'ws-a', initiativeBound: false, endWaiting: false };
  it('an unbound initiative: today\'s sentence', () => {
    expect(probeEpisodeText(base)).toBe('ccrc cannot tell whether initiatives are on in the Linear workspace ws-a, so the initiative of prog-a there is waiting. '
      + 'Its projects, milestones and issues still sync, not linked to an initiative; ccrc looks again at the next directory refill or plan change.');
  });
  it('a bound initiative: its update waits and its projects stay linked as they are', () => {
    const t = probeEpisodeText({ ...base, initiativeBound: true });
    expect(t).toContain("the initiative's update waits; its projects stay linked as they are");
    expect(t).not.toContain('not linked to an initiative');
    expect(t).not.toContain('closed once ccrc can tell');
  });
  it('a bound initiative of an ended programme: it stays unclosed until ccrc can tell', () => {
    const t = probeEpisodeText({ ...base, initiativeBound: true, endWaiting: true });
    expect(t).toContain("the initiative's update waits; its projects stay linked as they are");
    expect(t).toContain('closed once ccrc can tell');
  });
  it('an end waiting on an unbound initiative adds nothing (there is no initiative to close)', () => {
    expect(probeEpisodeText({ ...base, endWaiting: true })).toBe(probeEpisodeText(base));
  });
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

describe('an Upkeep epic: a snapshot with no programme (D-8183)', () => {
  const upkeep = (o: SnapOpts = {}): SyncSnapshot => ({ ...snap({ ...o, epic: { program: null, key: 'upkeep', waves: [], ...(o.epic ?? {}) } }), program: null });
  it('creates the project in the team: no initiative step, no skip for initiatives, no link, no milestones, no notice', () => {
    for (const initiatives of ['on', 'off'] as const) {
      const d = planSyncSteps(upkeep({ initiatives }));
      expect(ops(d.steps)).toEqual(['create:projectCreate']);
      expect(d.notices).toEqual([]);
      expect(d.waits).toEqual([]);
      expect(JSON.stringify(d.steps[0])).not.toContain('Part of');
      expect(d.steps[0]).toMatchObject({ input: { name: 'Epic one', teamIds: [TEAM] } });
    }
    // a workspace whose initiatives read `unknown` has nothing to wait for either: there is no initiative step to defer
    expect(planSyncSteps(upkeep({ wsInitiatives: 'unknown' })).waits).toEqual([]);
  });
  it('the bound project is never linked, and its owned fields name no initiative and no milestone', () => {
    const first = planSyncSteps(upkeep()).steps.find((x) => x.kind === 'create' && x.op === 'projectCreate');
    if (first?.kind !== 'create') throw new Error('no project create');
    const bound = upkeep({ bindings: [bind({ localKind: 'epic', localId: 1, fingerprint: first.fingerprint })] });
    const d = planSyncSteps(bound);
    expect(d.steps).toEqual([]);
    expect(d.owned).toEqual([expect.objectContaining({ kind: 'project', owned: expect.objectContaining({ initiativeIds: [], milestoneIds: [] }) })]);
  });
  it('an inbound ticket bound with the adopted fingerprint gets one absolute update into the project, never a create', () => {
    const first = planSyncSteps(upkeep({ tickets: [tk({ program: null, source: 'inbound', kind: 'task' })] })).steps.find((x) => x.kind === 'create' && x.op === 'projectCreate');
    if (first?.kind !== 'create') throw new Error('no project create');
    const s = upkeep({
      tickets: [tk({ program: null, source: 'inbound', kind: 'task' })],
      bindings: [bind({ localKind: 'epic', localId: 1, fingerprint: first.fingerprint }), bind({ localKind: 'ticket', localId: 1, fingerprint: 'adopted', identifier: 'AAA-12' })],
    });
    expect(ops(planSyncSteps(s).steps)).toEqual(['update:issueUpdate']);
    expect(planSyncSteps(s).steps[0]).toMatchObject({ input: { projectId: U(501), title: 'Ticket one' }, bindingId: expect.any(Number) });
  });
  it('a programme snapshot still reads its initiative step first (the null is only the Upkeep key)', () => {
    expect(ops(planSyncSteps(snap()).steps)).toEqual(['create:initiativeCreate', 'create:projectCreate']);
  });
});

describe('uuidOf (D-8183)', () => {
  it('is the v4-shaped hash requestIdOf builds from, so one function names every request id', () => {
    expect(uuidOf('ticket:1:ws-a:cancel')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(requestIdOf('ticket', 1, 'ws-a', 'cancel')).toBe(uuidOf('ticket:1:ws-a:cancel'));
    expect(requestIdOf('epic', 2, 'ws-a')).toBe(uuidOf('epic:2:ws-a'));
    expect(uuidOf('inbound:L1')).not.toBe(uuidOf('inbound:L2'));
    expect(uuidOf('inbound:L1')).toBe(uuidOf('inbound:L1'));
  });
});

describe('the inbound close\'s refusals (F8, A7/A8; L1)', () => {
  const steps = [30_000, 120_000, 600_000, 1_800_000];
  it('a key word holds the workspace on the failure-hold steps, the last repeating, and mails the owner', () => {
    const a = inboundActVerdict('linear-unauthorised', undefined, { now: 1000, backoffSteps: steps });
    expect(a).toEqual({ kind: 'retry', mailsOwner: true, keyRefused: true, hold: { until: 31_000, step: 1 } });
    const b = inboundActVerdict('linear-unauthorised', a.kind === 'retry' ? a.hold ?? undefined : undefined, { now: 40_000, backoffSteps: steps });
    expect(b).toEqual({ kind: 'retry', mailsOwner: true, keyRefused: true, hold: { until: 160_000, step: 2 } });
    const z = inboundActVerdict('linear-unauthorised', { until: 0, step: 9 }, { now: 0, backoffSteps: steps });
    expect(z).toMatchObject({ hold: { until: 1_800_000 } });
  });
  // A-2, the coordinator's ruling (b): not-configured is answered locally, so both lanes retry it at the next beat, with no hold.
  it('not-configured is retried at the next beat with no hold, and mails the owner', () => {
    expect(inboundActVerdict('not-configured', { until: 0, step: 3 }, { now: 0, backoffSteps: steps })).toEqual({ kind: 'retry', hold: null, mailsOwner: true, keyRefused: false });
    // @ts-expect-error not-configured is no DeferCause: the DEFERRALS row came out (A-2)
    expect(deferralOf('not-configured')).toBeUndefined();
  });
  it('another retry word holds without mailing; any other word gives up', () => {
    expect(inboundActVerdict('rate-limited', undefined, { now: 0, backoffSteps: steps })).toMatchObject({ kind: 'retry', mailsOwner: false });
    for (const w of ['linear-forbidden', 'not-found', 'linear-invalid', 'workspace-blocked']) expect(inboundActVerdict(w, undefined, { now: 0, backoffSteps: steps })).toEqual({ kind: 'give-up' });
  });
  it('only the key\'s refusal (a 401) is recorded for both lanes (review 2394 A-3)', () => {
    expect(inboundActVerdict('rate-limited', undefined, { now: 0, backoffSteps: steps })).toMatchObject({ keyRefused: false });
    expect(inboundActVerdict('linear-unauthorised', undefined, { now: 0, backoffSteps: steps })).toMatchObject({ keyRefused: true });
  });
  // Review 2408 F2: the give-up counts the close's own malformed answers, as the plan sync counts a binding's, never the
  // workspace's hold step, which every retry word of every close in the workspace moves. The step is the wait only.
  it('malformed is given up on the close\'s own count past the last step, whatever the workspace\'s step (review 2394 N1, 2408 F2)', () => {
    expect(inboundActVerdict('malformed', { until: 0, step: 4 }, { now: 0, backoffSteps: steps, malformedSeen: 1 })).toMatchObject({ kind: 'retry', hold: { step: 5 } });
    expect(inboundActVerdict('malformed', { until: 0, step: 0 }, { now: 0, backoffSteps: steps, malformedSeen: 4 })).toMatchObject({ kind: 'retry', hold: { step: 1 } });
    expect(inboundActVerdict('malformed', { until: 0, step: 0 }, { now: 0, backoffSteps: steps, malformedSeen: 5 })).toEqual({ kind: 'give-up' });
    expect(inboundActVerdict('rate-limited', { until: 0, step: 9 }, { now: 0, backoffSteps: steps })).toMatchObject({ kind: 'retry' });
  });
  // Review 2408 A-3: a rate limit's Retry-After floors the wait, as the plan sync floors the same deferral.
  it('a rate limit waits at least the answer\'s Retry-After (review 2408 A-3)', () => {
    expect(inboundActVerdict('rate-limited', undefined, { now: 1000, backoffSteps: steps, floorMs: 300_000 })).toMatchObject({ hold: { until: 301_000 } });
    expect(inboundActVerdict('rate-limited', undefined, { now: 1000, backoffSteps: steps, floorMs: 0 })).toMatchObject({ hold: { until: 31_000 } });
  });
  // Review 2408 A-2: each key word has its own mail, which says what ccrc does for that word.
  it('the two key words mail apart, and the not-configured mail says ccrc tries at every beat (review 2408 A-2)', () => {
    const row = { identifier: 'AAA-1', teamKey: 'AAA', title: 't', body: null };
    const none = keyWaitMail(row, 'not-configured');
    const refused = keyWaitMail(row, 'linear-unauthorised');
    expect(none.subject).not.toBe(refused.subject);
    expect(none.body).toContain('ccrc tries again at every beat and closes the issue once a key is set');
    expect(none.body).not.toContain('growing interval');
    expect(refused.body).toContain('on a growing interval');
  });
  it('inboundHeld is true strictly before until', () => {
    expect(inboundHeld(undefined, 5)).toBe(false);
    expect(inboundHeld({ until: 10, step: 1 }, 9)).toBe(true);
    expect(inboundHeld({ until: 10, step: 1 }, 10)).toBe(false);
  });
  it('givenUpReason marks the reason and givenUpWord reads it back', () => {
    expect(givenUpReason('noise', 'linear-forbidden')).toBe('noise [not closed in Linear: linear-forbidden]');
    expect(givenUpReason(null, 'not-found')).toBe('[not closed in Linear: not-found]');
    expect(givenUpWord('noise [not closed in Linear: linear-forbidden]')).toBe('linear-forbidden');
    expect(givenUpWord('noise')).toBeNull();
    expect(givenUpWord(null)).toBeNull();
  });
});

// Review 2457 F3: the public-text check of one write's texts has one owner, which the drift restore's comment asks too.
describe('textRefusalOf and textFactsOf (review 2457 F3)', () => {
  it('a public or unknown project refuses a text naming its own tracker id or a private key, a private one never', () => {
    expect(textRefusalOf(['Fix KEY-123 now'], [{ teamKey: 'KEY', mode: 'public' }], [])).toBe('tracker id');
    expect(textRefusalOf(['Fix KEY-123 now'], [{ teamKey: 'KEY', mode: 'unknown' }], [])).toBe('tracker id');
    expect(textRefusalOf(['Fix KEY-123 now'], [{ teamKey: 'KEY', mode: 'private' }], [])).toBeNull();
    expect(textRefusalOf(['Fix ZZZ-7 now'], [{ teamKey: 'KEY', mode: 'public' }], ['ZZZ'])).toBe('private tracker id');
    expect(textRefusalOf(['Backlog', 'Fine'], [{ teamKey: 'KEY', mode: 'public' }], [])).toBeNull();
  });

  it('every fact that speaks is asked: one public project among private ones refuses', () => {
    const facts = [{ teamKey: 'KEY', mode: 'private' as const }, { teamKey: 'KEY', mode: 'public' as const }];
    expect(textRefusalOf(['Fix KEY-123 now'], facts, [])).toBe('tracker id');
  });

  it("a ticket's, an epic's, a checkpoint's and an initiative's facts are those of their own projects", () => {
    const s = snap({ mode: 'public', teamKey: 'KEY', cps: [cp()], tickets: [tk()] });
    const fact = { teamKey: 'KEY', mode: 'public' };
    expect(textFactsOf(s, bind({ localKind: 'ticket', localId: 1 }))).toEqual([expect.objectContaining(fact)]);
    expect(textFactsOf(s, bind({ localKind: 'epic', localId: 1 }))).toEqual([expect.objectContaining(fact)]);
    expect(textFactsOf(s, bind({ localKind: 'checkpoint', localId: 1 }))).toEqual([expect.objectContaining(fact)]);
    expect(textFactsOf(s, bind({ localKind: 'programme', localId: 1 }))).toEqual([expect.objectContaining(fact)]);
  });

  it('an object the plan does not hold is judged unknown, public, with the binding\'s own team', () => {
    const s = snap({ mode: 'private', tickets: [tk()] });
    expect(textFactsOf(s, bind({ localKind: 'ticket', localId: 999, teamKey: 'BBB' }))).toEqual([{ teamKey: 'BBB', mode: 'unknown' }]);
  });
});

describe('textFactOfTeam (review 2834 F1)', () => {
  it('an owner reading stands as it is; no owner is the issue\'s own team, unknown (public)', () => {
    expect(textFactOfTeam({ teamKey: 'AAA', mode: 'private' }, 'ZZZ')).toEqual({ teamKey: 'AAA', mode: 'private' });
    expect(textFactOfTeam(null, 'CCC')).toEqual({ teamKey: 'CCC', mode: 'unknown' });
    expect(textFactOfTeam(null, null)).toEqual({ teamKey: null, mode: 'unknown' });
    expect(textRefusalOf(['dup of CCC-77'], [textFactOfTeam(null, 'CCC')], [])).toBe('tracker id');
  });
});
