// The phase deciders' cases (programme work map WM0, D-8715): `phaseNumbers`, `diffPhases` and `phaseRefVerdict`
// (`server/src/coord/planPolicy.ts`), each case written ONCE here over a module, so `plan-phases.test.ts` runs them against
// the real file and `sim/planPhasesSets.ts` against each named mutant (`mutation-floors.test.ts`). Pure data: no database.
import { expect } from 'vitest';
import type { PlanPhaseRefMoveBody, PlanPutBody } from '../../shared/plan.js';
import type { PhaseRow, StoredPlan, TicketRow } from '../src/coord/planStore.js';

export type PlanPolicyModule = typeof import('../src/coord/planPolicy.js');
export interface PhaseCase { name: string; run(m: PlanPolicyModule): void }

const ticket = (id: number, epicId: number, key: string, state: TicketRow['state']): TicketRow => ({
  id, program: 'prog-a', project: 'project-a', epicId, checkpointId: null, key, kind: 'work', title: key, body: '', source: 'plan',
  state, runId: null, droppedWhy: state === 'dropped' ? 'cut' : null, putBackAt: null,
});
const epic = (id: number, key: string, state: StoredPlan['epics'][number]['state'], tickets: TicketRow[]): StoredPlan['epics'][number] => ({
  id, program: 'prog-a', project: 'project-a', waves: [id], key, ordinal: id, title: key, summary: 's', state,
  droppedWhy: state === 'dropped' ? 'cut' : null, putBackAt: null, openedAt: null, doneAt: null, checkpoints: [], tickets,
});
/** e1 holds t1 open, t2 done and t3 dropped; e2 holds t4 open; e3 is dropped and holds t5 done. */
const STORED: StoredPlan = {
  program: 'prog-a', planBy: 'coord-a', required: true,
  epics: [
    epic(1, 'e1', 'active', [ticket(11, 1, 't1', 'open'), ticket(12, 1, 't2', 'done'), ticket(13, 1, 't3', 'dropped')]),
    epic(2, 'e2', 'planned', [ticket(14, 2, 't4', 'open')]),
    epic(3, 'e3', 'dropped', [ticket(15, 3, 't5', 'done')]),
  ],
};
type Ref = { kind: 'epic' | 'ticket'; refId: number; carriedTo?: number };
const phase = (id: number, key: string, ordinal: number, refs: Ref[] = [], dropped = false): PhaseRow => ({
  id, program: 'prog-a', key, ordinal, title: `Phase ${key}`, summary: 's', droppedWhy: dropped ? 'cut' : null,
  refs: refs.map((r, i) => ({
    id: id * 100 + i, phaseId: id, kind: r.kind, refId: r.refId, carriedTo: r.carriedTo ?? null, carriedAt: r.carriedTo === undefined ? null : 5,
  })),
});
/** p1, p2 and p3 live in order, pd dropped (after p3). */
const phases = (p1: Ref[] = [], p2: Ref[] = [], p3: Ref[] = [], pd: Ref[] = []): PhaseRow[] =>
  [phase(101, 'p1', 0, p1), phase(102, 'p2', 1, p2), phase(103, 'p3', 2, p3), phase(104, 'pd', 3, pd, true)];
const T1: Ref = { kind: 'ticket', refId: 11 };

const verdict = (m: PlanPolicyModule, move: PlanPhaseRefMoveBody, ph: PhaseRow[]) => m.phaseRefVerdict(move, STORED, ph);
type Answer = { ok: true } | { ok: false; word: string; detail: string };
const word = (r: { ok: boolean }): string => { const a = r as Answer; return a.ok ? 'ok' : a.word; };
/** The refusal's word and detail: a dropped phase also has no number, so only the detail tells its arm from "not later". */
const said = (r: { ok: boolean }): string => { const a = r as Answer; return a.ok ? 'ok' : `${a.word}: ${a.detail}`; };
const carry = (from: string, to: string, t = 't1'): PlanPhaseRefMoveBody => ({ op: 'carry', from, to, ticket: t });
const remove = (p: string, kind: 'epic' | 'ticket', key: string): PlanPhaseRefMoveBody => ({ op: 'remove', phase: p, ref: { kind, key } });
const add = (p: string, kind: 'epic' | 'ticket', key: string): PlanPhaseRefMoveBody => ({ op: 'add', phase: p, ref: { kind, key } });

/** A put naming e1 and e2 (e3 stays dropped, absent), with the given phases. */
const put = (ph: PlanPutBody['phases'], over: Partial<PlanPutBody> = {}): PlanPutBody => ({
  epics: [
    { key: 'e1', title: 'e1', summary: 's', waves: [1], checkpoints: [] },
    { key: 'e2', title: 'e2', summary: 's', waves: [2], checkpoints: [] },
  ],
  ...(ph === undefined ? {} : { phases: ph }), ...over,
});
const ph = (key: string, refs: { kind: 'epic' | 'ticket'; key: string }[] = [], droppedWhy?: string) =>
  ({ key, title: `Phase ${key}`, summary: 's', refs, ...(droppedWhy === undefined ? {} : { droppedWhy }) });
const LIVE3 = [ph('p1'), ph('p2'), ph('p3')];

export const PHASE_CASES: PhaseCase[] = [
  // ── phaseNumbers (review 2268 F6) ──
  { name: 'a phase\'s number counts only the phases not dropped, in order', run: (m) => {
    expect([...m.phaseNumbers([{ key: 'a', dropped: false }, { key: 'x', dropped: true }, { key: 'b', dropped: false }])])
      .toEqual([['a', 1], ['b', 2]]);
  } },

  // ── carry: each bad-carry arm, and the carries that hold ──
  { name: 'a carry of a ticket the phase references moves it to a later phase', run: (m) => {
    expect(verdict(m, carry('p1', 'p2'), phases([T1]))).toEqual({ ok: true, write: { kind: 'carry', fromPhaseId: 101, toPhaseId: 102, ticketId: 11 } });
  } },
  { name: 'a carry out of a whole-epic reference holds', run: (m) => {
    expect(word(verdict(m, carry('p1', 'p3'), phases([{ kind: 'epic', refId: 1 }])))).toBe('ok');
  } },
  { name: 'bad-carry: the from phase is dropped, and the detail says so', run: (m) => {
    expect(said(verdict(m, carry('pd', 'p3'), phases([], [], [], [T1])))).toBe('bad-carry: phase pd was dropped');
  } },
  { name: 'bad-carry: the to phase is dropped, and the detail says so', run: (m) => {
    expect(said(verdict(m, carry('p1', 'pd'), phases([T1])))).toBe('bad-carry: phase pd was dropped');
  } },
  { name: 'bad-carry: the to phase is not later (earlier, or the same phase)', run: (m) => {
    expect(word(verdict(m, carry('p2', 'p1'), phases([], [T1])))).toBe('bad-carry');
    expect(word(verdict(m, carry('p1', 'p1'), phases([T1])))).toBe('bad-carry');
  } },
  { name: 'bad-carry: the ticket is done', run: (m) => {
    expect(word(verdict(m, carry('p1', 'p2', 't2'), phases([{ kind: 'ticket', refId: 12 }])))).toBe('bad-carry');
  } },
  { name: 'bad-carry: the ticket is not the from phase\'s work', run: (m) => {
    expect(word(verdict(m, carry('p1', 'p2', 't4'), phases([T1])))).toBe('bad-carry');
  } },
  { name: 'bad-carry: a ticket already carried out of the phase is not its work', run: (m) => {
    expect(word(verdict(m, carry('p1', 'p3'), phases([{ ...T1, carriedTo: 102 }], [T1])))).toBe('bad-carry');
  } },
  { name: 'a carry to a dropped phase is void: the ticket is the phase\'s work again and carries on', run: (m) => {
    expect(word(verdict(m, carry('p1', 'p3'), phases([{ ...T1, carriedTo: 104 }])))).toBe('ok');
  } },
  { name: 'bad-carry: a dropped ticket held through its epic is not the phase\'s work', run: (m) => {
    expect(word(verdict(m, carry('p1', 'p2', 't3'), phases([{ kind: 'epic', refId: 1 }])))).toBe('bad-carry');
  } },
  { name: 'a carry naming an unknown phase or ticket is unknown-ref', run: (m) => {
    expect(word(verdict(m, carry('p9', 'p2'), phases([T1])))).toBe('unknown-ref');
    expect(word(verdict(m, carry('p1', 'p9'), phases([T1])))).toBe('unknown-ref');
    expect(word(verdict(m, carry('p1', 'p2', 'zz'), phases([T1])))).toBe('unknown-ref');
  } },

  // ── add and remove (unknown-ref, and F12's remove rule) ──
  { name: 'add inserts a reference, and a held one changes nothing', run: (m) => {
    expect(verdict(m, add('p1', 'ticket', 't4'), phases())).toEqual({ ok: true, write: { kind: 'insert', phaseId: 101, refKind: 'ticket', refId: 14 } });
    expect(verdict(m, add('p1', 'epic', 'e2'), phases())).toEqual({ ok: true, write: { kind: 'insert', phaseId: 101, refKind: 'epic', refId: 2 } });
    expect(verdict(m, add('p1', 'ticket', 't1'), phases([T1]))).toEqual({ ok: true, write: { kind: 'none' } });
  } },
  { name: 'unknown-ref: a new reference to a dropped or unknown object', run: (m) => {
    expect(word(verdict(m, add('p1', 'ticket', 't3'), phases()))).toBe('unknown-ref');
    expect(word(verdict(m, add('p1', 'epic', 'e3'), phases()))).toBe('unknown-ref');
    expect(word(verdict(m, add('p1', 'ticket', 'zz'), phases()))).toBe('unknown-ref');
  } },
  { name: 'unknown-ref: add or remove on a dropped or unknown phase', run: (m) => {
    expect(word(verdict(m, add('pd', 'ticket', 't1'), phases()))).toBe('unknown-ref');
    expect(word(verdict(m, add('p9', 'ticket', 't1'), phases()))).toBe('unknown-ref');
    expect(word(verdict(m, remove('pd', 'ticket', 't1'), phases([], [], [], [T1])))).toBe('unknown-ref');
  } },
  { name: 'remove deletes a reference the phase holds, and a reference it does not hold is unknown-ref', run: (m) => {
    expect(verdict(m, remove('p1', 'ticket', 't1'), phases([T1]))).toEqual({ ok: true, write: { kind: 'delete', refRowId: 10100 } });
    expect(word(verdict(m, remove('p1', 'ticket', 't4'), phases([T1])))).toBe('unknown-ref');
  } },
  { name: 'F12: removing the source end of a recorded carry is bad-carry', run: (m) => {
    expect(word(verdict(m, remove('p1', 'ticket', 't1'), phases([{ ...T1, carriedTo: 102 }], [T1])))).toBe('bad-carry');
  } },
  { name: 'F12: removing the target end of a recorded carry is bad-carry', run: (m) => {
    expect(word(verdict(m, remove('p2', 'ticket', 't1'), phases([{ ...T1, carriedTo: 102 }], [T1])))).toBe('bad-carry');
  } },
  { name: 'F12: every other remove is allowed (a void carry\'s source, a whole-epic reference, a plain ticket reference)', run: (m) => {
    expect(word(verdict(m, remove('p1', 'ticket', 't1'), phases([{ ...T1, carriedTo: 104 }])))).toBe('ok');
    expect(word(verdict(m, remove('p1', 'epic', 'e1'), phases([{ kind: 'epic', refId: 1 }, { ...T1, carriedTo: 102 }], [T1])))).toBe('ok');
    expect(word(verdict(m, remove('p3', 'ticket', 't1'), phases([{ ...T1, carriedTo: 102 }], [T1], [T1])))).toBe('ok');
  } },

  // ── diffPhases: a put's phases ──
  { name: 'a put with no phases key changes no phase', run: (m) => {
    expect(m.diffPhases(STORED, phases([T1]), put(undefined))).toEqual({ ok: true, changes: undefined });
  } },
  { name: 'a put inserts new phases in order with the references it adds', run: (m) => {
    const d = m.diffPhases(STORED, [], put([ph('a', [{ kind: 'epic', key: 'e1' }]), ph('b', [{ kind: 'ticket', key: 't4' }])]));
    expect(d).toEqual({ ok: true, changes: {
      phases: { insert: [{ key: 'a', ordinal: 0, title: 'Phase a', summary: 's' }, { key: 'b', ordinal: 1, title: 'Phase b', summary: 's' }], update: [], drop: [] },
      refs: [{ phaseKey: 'a', kind: 'epic', key: 'e1' }, { phaseKey: 'b', kind: 'ticket', key: 't4' }],
    } });
  } },
  { name: 'dropped-needs-reason: a stored phase left out of the put', run: (m) => {
    expect(word(m.diffPhases(STORED, phases(), put([ph('p1'), ph('p3')])))).toBe('dropped-needs-reason');
  } },
  { name: 'a phase dropped with a reason is dropped; a new one cannot carry droppedWhy; a dropped one is not revived', run: (m) => {
    const d = m.diffPhases(STORED, phases(), put([ph('p1'), ph('p2', [], 'cut'), ph('p3'), ph('pd')]));
    expect(d.ok && d.changes!.phases.drop).toEqual([{ id: 102, why: 'cut' }]);
    expect(d.ok && d.changes!.phases.update).toEqual([]);
    expect(word(m.diffPhases(STORED, [], put([ph('n', [], 'cut')])))).toBe('plan-bad-body');
  } },
  { name: 'unknown-ref: a put\'s new reference to a dropped or unknown object', run: (m) => {
    expect(word(m.diffPhases(STORED, [], put([ph('a', [{ kind: 'ticket', key: 't3' }])])))).toBe('unknown-ref');
    expect(word(m.diffPhases(STORED, [], put([ph('a', [{ kind: 'epic', key: 'e3' }])])))).toBe('unknown-ref');
    expect(word(m.diffPhases(STORED, [], put([ph('a', [{ kind: 'ticket', key: 'zz' }])])))).toBe('unknown-ref');
    // a dropped epic the put names again is not revived (diffPlan skips it), so it is still not referable
    expect(word(m.diffPhases(STORED, [], put([ph('a', [{ kind: 'epic', key: 'e3' }])], {
      epics: [...put(undefined).epics, { key: 'e3', title: 'e3', summary: 's', waves: [3], checkpoints: [] }],
    })))).toBe('unknown-ref');
    // an open ticket of an epic the same put drops drops with it
    expect(word(m.diffPhases(STORED, [], put([ph('a', [{ kind: 'ticket', key: 't4' }])], {
      epics: [{ key: 'e1', title: 'e1', summary: 's', waves: [1], checkpoints: [] }, { key: 'e2', title: 'e2', summary: 's', waves: [2], checkpoints: [], droppedWhy: 'cut' }],
    })))).toBe('unknown-ref');
  } },
  { name: 'a put may reference a ticket it adds, and a done ticket of a dropped epic', run: (m) => {
    const withNew = put([ph('a', [{ kind: 'ticket', key: 'tn' }, { kind: 'ticket', key: 't5' }])]);
    withNew.epics[1]!.tickets = [{ key: 'tn', kind: 'work', title: 'new' }];
    expect(word(m.diffPhases(STORED, [], withNew))).toBe('ok');
  } },
  { name: 'a reference stored before its object dropped is kept, never refused, never re-added', run: (m) => {
    const d = m.diffPhases(STORED, phases([{ kind: 'ticket', refId: 13 }]), put([ph('p1', [{ kind: 'ticket', key: 't3' }]), ph('p2'), ph('p3')]));
    expect(d.ok && d.changes!.refs).toEqual([]);
  } },
  { name: 'F12: a put that orders a carry\'s target at or before its source is bad-carry', run: (m) => {
    const ph3 = phases([{ ...T1, carriedTo: 102 }], [T1]);
    expect(word(m.diffPhases(STORED, ph3, put([ph('p2'), ph('p1'), ph('p3')])))).toBe('bad-carry');
    expect(word(m.diffPhases(STORED, ph3, put(LIVE3)))).toBe('ok');
    // dropping the carry's target (with its reason) voids the carry, so its order no longer binds
    expect(word(m.diffPhases(STORED, ph3, put([ph('p2', [], 'cut'), ph('p1'), ph('p3')])))).toBe('ok');
  } },
];
