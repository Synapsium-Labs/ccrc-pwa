// D-8183 (Linear hierarchy plan, Task 4.2 A): the planned owned fields the drift pass compares come out of the sync's own
// deciders (`planSyncSteps`' `owned`), and a forced binding is treated as not current (the restore's step). Pure: no I/O.
import { describe, expect, it } from 'vitest';
import type { BindingRow, CheckpointRow, EpicRow, StoredPlan, TicketRow } from '../src/coord/planStore.js';
import { planSyncSteps, requestIdOf, type PlannedOwned, type SyncSnapshot } from '../src/linear/planSyncPolicy.js';

const U = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const WS = 'ws-a';
const PROG = U(701); const PROJ = U(702); const MS = U(703); const ISS = U(704);

const epic = (o: Partial<EpicRow> = {}): EpicRow => ({
  id: 1, program: 'prog', project: 'proj-a', waves: [1], key: 'e1', ordinal: 0, title: 'Epic one', summary: 'The summary', state: 'active',
  droppedWhy: null, putBackAt: null, openedAt: null, doneAt: null, ...o,
});
const cp = (o: Partial<CheckpointRow> = {}): CheckpointRow => ({
  id: 1, epicId: 1, key: 'c1', ordinal: 3, title: 'Checkpoint one', kind: 'acceptance', proves: [], state: 'open', droppedWhy: null,
  putBackAt: null, metAt: null, evidence: null, itemId: null, ...o,
});
const tk = (o: Partial<TicketRow> = {}): TicketRow => ({
  id: 1, program: 'prog', project: 'proj-a', epicId: 1, checkpointId: 1, key: 't1', kind: 'work', title: 'Ticket one', body: 'Do the thing',
  source: 'plan', state: 'started', runId: null, droppedWhy: null, putBackAt: null, ...o,
});
const dir = {
  viewerId: U(9), labels: [], projects: [], users: [], initiatives: 'on' as const,
  states: [{ id: U(21), name: 'Todo', type: 'unstarted', teamKey: 'AAA' }, { id: U(22), name: 'Doing', type: 'started', teamKey: 'AAA' },
    { id: U(23), name: 'Done', type: 'completed', teamKey: 'AAA' }, { id: U(24), name: 'Nope', type: 'canceled', teamKey: 'AAA' }],
  projectStatuses: [{ id: U(31), name: 'P', type: 'planned' }, { id: U(32), name: 'S', type: 'started' },
    { id: U(33), name: 'C', type: 'completed' }, { id: U(34), name: 'X', type: 'canceled' }],
};
const bind = (kind: BindingRow['localKind'], localId: number, linearId: string, o: Partial<BindingRow> = {}): BindingRow => ({
  id: { programme: 1, epic: 2, checkpoint: 3, ticket: 4 }[kind], localKind: kind, localId, workspaceId: WS, teamKey: 'AAA', linearId,
  identifier: kind === 'ticket' ? 'AAA-1' : null, fingerprint: 'stale', syncedAt: 1, state: 'bound', failedAt: null, failedWord: null,
  failedInputs: null, driftCount: 0, driftSince: null, heldItemId: null, ...o,
});
function snap(o: { bindings?: BindingRow[]; cps?: CheckpointRow[]; tickets?: TicketRow[]; initiatives?: 'on' | 'off'; epicState?: EpicRow['state'] } = {}): SyncSnapshot {
  const plan: StoredPlan = {
    program: 'prog', planBy: null, required: true,
    epics: [{ ...epic({ state: o.epicState ?? 'active' }), checkpoints: o.cps ?? [cp()], tickets: o.tickets ?? [tk()] }],
  };
  return {
    program: { slug: 'prog', rowid: 7, title: 'The programme', end: null, inShort: 'Short words', doneWhen: [{ text: 'It works', proved: false }] },
    plan, bindings: o.bindings ?? [],
    workspaces: [{ workspaceId: WS, initiatives: 'on', directory: dir, teams: [{ id: U(1), key: 'AAA' }, { id: U(3), key: 'BBB' }] }],
    projects: [{ project: 'proj-a', teamKey: 'AAA', workspaceId: WS, mode: 'private', initiatives: o.initiatives ?? 'on' }],
    privateTrackerKeys: [],
  };
}
const allBound = (o: Parameters<typeof snap>[0] = {}): BindingRow[] => [
  bind('programme', 7, PROG), bind('epic', 1, PROJ), bind('checkpoint', 1, MS), bind('ticket', 1, ISS), ...(o.bindings ?? []),
];
/** Every object bound at the fingerprint the sync would have written, found by planning and applying each step until none is left. */
function settledFps(): BindingRow[] {
  let bindings = allBound();
  for (let i = 0; i < 4; i += 1) {
    const steps = planSyncSteps(snap({ bindings })).steps;
    const fp = new Map<number, string>();
    for (const x of steps) if (x.kind === 'update' || x.kind === 'link') fp.set(x.bindingId, x.fingerprint);
    if (fp.size === 0) break;
    bindings = bindings.map((b) => ({ ...b, fingerprint: fp.get(b.id) ?? b.fingerprint }));
  }
  return bindings;
}
const ownedOf = (s: SyncSnapshot, kind: PlannedOwned['kind']): PlannedOwned | undefined => planSyncSteps(s).owned.find((x) => x.kind === kind);

describe('planSyncSteps outputs the planned owned fields (D-8183)', () => {
  it('each bound object has its planned fields in Linear\'s terms', () => {
    const s = snap({ bindings: allBound() });
    const out = planSyncSteps(s).owned;
    expect(out.map((x) => [x.kind, x.bindingId, x.local])).toEqual([
      ['initiative', 1, { kind: 'programme', id: 7 }], ['project', 2, { kind: 'epic', id: 1 }],
      ['milestone', 3, { kind: 'checkpoint', id: 1 }], ['issue', 4, { kind: 'ticket', id: 1 }],
    ]);
    expect(ownedOf(s, 'initiative')!.owned).toMatchObject({ name: 'The programme', status: 'Active', projectIds: [PROJ] });
    expect(String(ownedOf(s, 'initiative')!.owned['description'])).toContain('Short words');
    expect(ownedOf(s, 'project')!.owned).toMatchObject({
      name: 'Epic one', statusType: 'started', teamKeys: ['AAA'], initiativeIds: [PROG], milestoneIds: [MS],
    });
    expect(ownedOf(s, 'milestone')!.owned).toMatchObject({ name: 'Checkpoint one', sortOrder: 3, projectId: PROJ });
    expect(ownedOf(s, 'milestone')!.owned['targetDate']).toBeUndefined();               // not met: D-8700
    expect(ownedOf(s, 'issue')!.owned).toMatchObject({
      title: 'Ticket one', teamKey: 'AAA', projectId: PROJ, milestoneId: MS, stateType: 'started',
    });
    expect(ownedOf(s, 'issue')!.owned['parentId']).toBeUndefined();                     // ccrc sets no parent
  });

  it('a met checkpoint owns its target date', () => {
    const s = snap({ bindings: allBound(), cps: [cp({ state: 'met', metAt: Date.UTC(2026, 10, 12), evidence: { itemId: 5 } })] });
    expect(ownedOf(s, 'milestone')!.owned['targetDate']).toBe('2026-11-12');
  });

  it('a project links its initiative only when the setting is on, and an initiative lists no project when none links', () => {
    const off = snap({ bindings: allBound(), initiatives: 'off' });
    expect(ownedOf(off, 'project')!.owned['initiativeIds']).toEqual([]);
    expect(planSyncSteps(off).owned.find((x) => x.kind === 'initiative')).toBeUndefined();   // off: no initiative step at all
  });

  it('current says whether the stored fingerprint is the plan\'s current one', () => {
    const fresh = snap({ bindings: allBound() });
    expect(planSyncSteps(fresh).owned.map((x) => x.current)).toEqual([false, false, false, false]);   // every fingerprint is "stale"
    const settled = snap({ bindings: settledFps() });
    expect(planSyncSteps(settled).steps).toEqual([]);                                                // converged
    expect(planSyncSteps(settled).owned.map((x) => [x.kind, x.current])).toEqual([['initiative', true], ['project', true], ['milestone', true], ['issue', true]]);
  });

  it('a failed binding, an unbound object and a pending one have no planned fields', () => {
    const s = snap({ bindings: [bind('programme', 7, PROG), bind('epic', 1, PROJ, { state: 'failed', failedWord: 'linear-invalid' }), bind('ticket', 1, ISS, { state: 'pending', linearId: null })] });
    expect(planSyncSteps(s).owned.map((x) => x.kind)).toEqual(['initiative']);
  });
});

describe('planSyncSteps with a forced binding (D-8183)', () => {
  it('a current binding emits nothing until it is forced, then its absolute update', () => {
    const bindings = settledFps();
    const quiet = planSyncSteps(snap({ bindings }));
    expect(quiet.steps.filter((x) => x.kind === 'update' && x.bindingId === 4)).toEqual([]);
    const forced = planSyncSteps(snap({ bindings }), { force: new Map([[4, '123']]) });
    const upd = forced.steps.filter((x) => x.kind === 'update');
    expect(upd.map((x) => x.kind === 'update' && [x.bindingId, x.op])).toEqual([[4, 'issueUpdate']]);
    expect(upd[0]).toMatchObject({ input: { id: ISS, projectId: PROJ, projectMilestoneId: MS } });
  });

  it('a forced project under a live initiative also emits its link, with a requestId of its own', () => {
    const bindings = settledFps();
    const forced = planSyncSteps(snap({ bindings }), { force: new Map([[2, '123']]) });
    expect(forced.steps.map((x) => (x.kind === 'skip' ? 'skip' : `${x.kind}:${x.op}:${x.bindingId}`))).toEqual(['update:projectUpdate:2', 'link:initiativeToProjectCreate:2']);
    const link = forced.steps.find((x) => x.kind === 'link')!;
    expect(link.kind === 'link' && link.requestId).toBe(requestIdOf('epic', 1, WS, 'restore-123'));
    expect(link.kind === 'link' && link.requestId).not.toBe(requestIdOf('epic', 1, WS, 'link'));
    expect(link.kind === 'link' && link.input).toMatchObject({ initiativeId: PROG, projectId: PROJ });
  });

  it('a forced binding that is failed is still never sent, and an unforced plan is unchanged by the option', () => {
    const bindings = settledFps().map((b) => (b.id === 4 ? { ...b, state: 'failed' as const } : b));
    expect(planSyncSteps(snap({ bindings }), { force: new Map([[4, 'x']]) }).steps).toEqual([]);
    const plain = snap({ bindings: allBound() });
    expect(planSyncSteps(plain, { force: new Map() }).steps).toEqual(planSyncSteps(plain).steps);
  });

  it('requestIdOf takes a restore part, v4-shaped and apart from the others', () => {
    const a = requestIdOf('epic', 4, WS, 'restore-1');
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a).not.toBe(requestIdOf('epic', 4, WS, 'restore-2'));
  });
});
