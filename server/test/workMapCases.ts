// The programme work map WM2's deciders (D-8779; spec 2026-11-16 §3.1, §4, §5.1 and §7): `workMapOf` (Tables 6 and 6a, the
// four plan states, the strip and the fallback) and `doneEvidenceVerdict` (the read side of §4.1's evidence rule), in
// `server/src/coord/workMap.ts`. Each case is written ONCE here over a module, so `work-map.test.ts` runs them against the
// real file and `sim/workMapSets.ts` against each named mutant (`mutation-floors.test.ts`). Pure data: no database.
import { expect } from 'vitest';
import type { EpicView, PhaseView, TicketView, WorkItemView, WorkMapView, WorkPhaseView } from '../../shared/plan.js';
import type { DoneEvidenceFacts, WorkMapInput, WorkMapRun } from '../src/coord/workMap.js';

export type WorkMapModule = typeof import('../src/coord/workMap.js');
export interface WorkMapCase { name: string; run(m: WorkMapModule): void }

// ── Builders ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const tk = (key: string, over: Partial<TicketView> = {}): TicketView => ({
  key, kind: 'work', title: `T ${key}`, project: 'project-a', checkpoint: null, source: 'plan', state: 'open', runId: null,
  identifier: null, url: null, sync: 'none', syncWord: null, ...over,
});
const ep = (key: string, tickets: TicketView[], over: Partial<EpicView> = {}): EpicView => ({
  key, title: `Epic ${key}`, summary: 's', project: 'project-a', waves: [1], state: 'active', url: null, sync: 'none',
  syncWord: null, checkpoints: [], tickets, ...over,
});
type Ref = { kind: 'epic' | 'ticket'; key: string; carriedTo?: string | null; carriedAt?: number | null };
const ph = (key: string, refs: Ref[], over: Partial<PhaseView> = {}): PhaseView => ({
  key, number: null, title: `Phase ${key}`, summary: 'p', dropped: false,
  refs: refs.map((r) => ({ kind: r.kind, key: r.key, carriedTo: r.carriedTo ?? null, carriedAt: r.carriedAt ?? null })), ...over,
});
const tref = (key: string, carriedTo: string | null = null, carriedAt: number | null = null): Ref => ({ kind: 'ticket', key, carriedTo, carriedAt });
const eref = (key: string): Ref => ({ kind: 'epic', key });
const run = (id: number, state: WorkMapRun['state'], over: Partial<WorkMapRun> = {}): WorkMapRun => ({
  id, kind: 'work', state, wave: id, programTitle: 'Prog A', runTitle: `Run ${id}`, lastMoveAt: null, ticketKey: null, ...over,
});
const HOLDS = { holds: true } as const;
type In = {
  epics?: EpicView[]; phases?: PhaseView[]; end?: WorkMapView['end']; declared?: boolean;
  done?: [string, { at: number | null; evidence: { runId: number } | { pr: number } | 'malformed' | null }][];
  runs?: WorkMapRun[]; verdicts?: WorkMapInput['verdicts']; openItems?: { id: number; runId: number | null }[];
  checkpointItems?: [string, number][]; evidence?: [string, { holds: true } | { holds: false; reason: string }][];
  closed?: [string, string][]; initiatives?: WorkMapView['initiatives']; doneWhen?: WorkMapView['doneWhen'];
};
const input = (o: In): WorkMapInput => ({
  plan: {
    program: 'prog-a', planned: (o.epics ?? []).length > 0, initiatives: o.initiatives ?? [], epics: o.epics ?? [],
    doneWhen: o.doneWhen ?? [], ...(o.phases === undefined ? {} : { phases: o.phases }),
    declared: o.declared ?? true, end: o.end ?? null, done: new Map(o.done ?? []),
  },
  runs: o.runs ?? [], verdicts: o.verdicts ?? new Map(), openItems: o.openItems ?? [],
  checkpointItems: new Map(o.checkpointItems ?? []), evidence: new Map(o.evidence ?? []), closed: new Map(o.closed ?? []),
});
const map = (m: WorkMapModule, o: In): WorkMapView => m.workMapOf(input(o));
const item = (v: WorkMapView, key: string): WorkItemView => {
  const i = v.items.find((x) => x.key === key);
  if (i === undefined) throw new Error(`no item ${key}`);
  return i;
};
const status = (m: WorkMapModule, o: In, key = 't1'): string => item(map(m, o), key).status;
const phase = (v: WorkMapView, key: string): WorkPhaseView => {
  const p = v.phases.find((x) => x.key === key);
  if (p === undefined) throw new Error(`no phase ${key}`);
  return p;
};
/** The non-zero groups of a counts record, as `group:n` words in WORK_GROUPS order. */
const nz = (c: Record<string, number>): string[] => Object.entries(c).filter(([, n]) => n !== 0).map(([g, n]) => `${g}:${n}`);
const ENDED: WorkMapView['end'] = { outcome: 'done', why: null, at: 9_000 };
/** A ticket held by run `id` in state `state`. */
const held = (state: WorkMapRun['state'], over: In = {}, id = 7): In => ({
  epics: [ep('e1', [tk('t1', { state: 'started', runId: id })])], runs: [run(id, state, { ticketKey: 't1' })], ...over,
});
/** A done ticket whose stored evidence is `{ runId: 5 }`, with the given verdict (none: holds). */
const doneT = (verdict: { holds: true } | { holds: false; reason: string } = HOLDS, over: In = {}): In => ({
  epics: [ep('e1', [tk('t1', { state: 'done', runId: 5 })])], runs: [run(5, 'done', { ticketKey: 't1' })],
  done: [['t1', { at: 500, evidence: { runId: 5 } }]], evidence: [['t1', verdict]], ...over,
});
const BROKEN = { holds: false, reason: 'run 5 is failed, not done' } as const;

// ── Table 6: one case per row, and the order between neighbours ─────────────────────────────────────────────────────

export const STATUS_CASES: WorkMapCase[] = [
  { name: 'row 1: a dropped ticket reads dropped, in its own group', run: (m) => {
    const v = map(m, { epics: [ep('e1', [tk('t1', { state: 'dropped' })])] });
    expect([item(v, 't1').status, item(v, 't1').group]).toEqual(['dropped', 'dropped']);
  } },
  { name: 'row 1 before row 2: a dropped ticket the close names still reads dropped', run: (m) => {
    expect(status(m, { epics: [ep('e1', [tk('t1', { state: 'dropped' })])], closed: [['t1', 'superseded']] })).toBe('dropped');
  } },
  { name: 'row 2: a closed ticket reads closed with its reason and counts apart', run: (m) => {
    const v = map(m, { epics: [ep('e1', [tk('t1'), tk('t2')])], closed: [['t1', 'not needed']] });
    expect([item(v, 't1').status, item(v, 't1').group, item(v, 't1').reason]).toEqual(['closed', 'closed', 'not needed']);
    expect(nz(v.counts)).toEqual(['not-started:1', 'closed:1']);
  } },
  { name: 'row 2 before row 3: a closed ticket marked done reads closed', run: (m) => {
    expect(status(m, doneT(HOLDS, { closed: [['t1', 'folded elsewhere']] }))).toBe('closed');
  } },
  { name: 'row 3: a done ticket whose evidence verifies reads done, with its time', run: (m) => {
    const v = map(m, doneT());
    expect([item(v, 't1').status, item(v, 't1').group, item(v, 't1').doneAt]).toEqual(['done', 'done', 500]);
  } },
  { name: 'row 3 before row 5: an ended plan\'s verified done ticket reads done', run: (m) => {
    expect(status(m, doneT(HOLDS, { end: ENDED }))).toBe('done');
  } },
  { name: 'row 4: evidence that no longer holds reads done-unverified with its reason, in held', run: (m) => {
    const v = map(m, doneT(BROKEN));
    expect([item(v, 't1').status, item(v, 't1').group, item(v, 't1').reason]).toEqual(['done-unverified', 'held', 'run 5 is failed, not done']);
  } },
  { name: 'row 4: a done ticket with no evidence stored reads done-unverified, "no evidence stored"', run: (m) => {
    const v = map(m, doneT(HOLDS, { done: [['t1', { at: null, evidence: null }]], evidence: [] }));
    expect([item(v, 't1').status, item(v, 't1').reason]).toEqual(['done-unverified', 'no evidence stored']);
  } },
  { name: 'row 4 before row 6: a done-unverified ticket with an open item on its run is not waiting on you', run: (m) => {
    expect(status(m, doneT(BROKEN, { openItems: [{ id: 3, runId: 5 }] }))).toBe('done-unverified');
  } },
  { name: 'row 5: an ended plan\'s open ticket reads left-open, in its own group', run: (m) => {
    const v = map(m, { epics: [ep('e1', [tk('t1')])], end: ENDED });
    expect([item(v, 't1').status, item(v, 't1').group]).toEqual(['left-open', 'left-open']);
  } },
  { name: 'row 5 before row 4: an ended plan\'s done-unverified ticket reads left-open and counts in no outstanding total (review 2382 L3-F1)', run: (m) => {
    const v = map(m, doneT(BROKEN, { end: ENDED }));
    expect([item(v, 't1').status, item(v, 't1').reason]).toEqual(['left-open', null]);
    expect(nz(v.counts)).toEqual(['left-open:1']);
  } },
  { name: 'row 5 before row 6: an ended plan\'s ticket with an open item reads left-open', run: (m) => {
    expect(status(m, held('working', { end: ENDED, openItems: [{ id: 3, runId: 7 }] }))).toBe('left-open');
  } },
  { name: 'row 6: an open item on the ticket\'s run makes it waiting on you, naming the item', run: (m) => {
    const v = map(m, held('working', { openItems: [{ id: 3, runId: 7 }, { id: 4, runId: 99 }] }));
    expect([item(v, 't1').status, item(v, 't1').group, item(v, 't1').itemIds]).toEqual(['waiting-on-you', 'waiting-on-you', [3]]);
  } },
  { name: 'row 6: an open item on the ticket\'s operator-act checkpoint makes it waiting on you', run: (m) => {
    const cps = [{ key: 'c1', title: 'c', kind: 'operator-act' as const, state: 'open' as const, proves: [], metAt: null, evidence: null, url: null, sync: 'none' as const, syncWord: null }];
    const v = map(m, { epics: [ep('e1', [tk('t1', { checkpoint: 'c1' })], { checkpoints: cps })], checkpointItems: [['e1/c1', 8]] });
    expect([item(v, 't1').status, item(v, 't1').itemIds]).toEqual(['waiting-on-you', [8]]);
  } },
  { name: 'row 6: an acceptance checkpoint\'s item does not make it waiting on you', run: (m) => {
    const cps = [{ key: 'c1', title: 'c', kind: 'acceptance' as const, state: 'open' as const, proves: [], metAt: null, evidence: null, url: null, sync: 'none' as const, syncWord: null }];
    expect(status(m, { epics: [ep('e1', [tk('t1', { checkpoint: 'c1' })], { checkpoints: cps })], checkpointItems: [['e1/c1', 8]] })).toBe('not-started');
  } },
  { name: 'two epics with the same checkpoint key keep their items apart', run: (m) => {
    const cp = { key: 'c1', title: 'c', kind: 'operator-act' as const, state: 'open' as const, proves: [], metAt: null, evidence: null, url: null, sync: 'none' as const, syncWord: null };
    const v = map(m, {
      epics: [ep('e1', [tk('t1', { checkpoint: 'c1' })], { checkpoints: [cp] }), ep('e2', [tk('t2', { checkpoint: 'c1' })], { checkpoints: [cp] })],
      checkpointItems: [['e2/c1', 9]],
    });
    expect([item(v, 't1').status, item(v, 't2').status, item(v, 't2').itemIds]).toEqual(['not-started', 'waiting-on-you', [9]]);
  } },
  { name: 'row 6 before row 7: an open item on the run beats a stuck verdict', run: (m) => {
    expect(status(m, held('working', { openItems: [{ id: 3, runId: 7 }], verdicts: new Map([[7, { stuck: true, blockedBy: null }]]) }))).toBe('waiting-on-you');
  } },
  { name: 'row 7: a stuck verdict reads stuck, in held', run: (m) => {
    const v = map(m, held('working', { verdicts: new Map([[7, { stuck: true, blockedBy: null }]]) }));
    expect([item(v, 't1').status, item(v, 't1').group]).toEqual(['stuck', 'held']);
  } },
  { name: 'row 7 before row 9: stuck beats working', run: (m) => {
    expect(status(m, held('dispatched', { verdicts: new Map([[7, { stuck: true, blockedBy: null }]]) }))).toBe('stuck');
  } },
  { name: 'row 8: a planned run behind another reads blocked, in held', run: (m) => {
    const v = map(m, held('planned', { verdicts: new Map([[7, { stuck: false, blockedBy: 3 }]]) }));
    expect([item(v, 't1').status, item(v, 't1').group]).toEqual(['blocked', 'held']);
  } },
  { name: 'row 8 reads only a planned run: a working run with a blockedBy reads working', run: (m) => {
    expect(status(m, held('working', { verdicts: new Map([[7, { stuck: false, blockedBy: 3 }]]) }))).toBe('working');
  } },
  { name: 'verdicts not read skips stuck and blocked and says so', run: (m) => {
    const v = map(m, held('working', { verdicts: 'not-read' }));
    expect([item(v, 't1').status, v.verdicts]).toEqual(['working', 'not-read']);
    expect(status(m, held('planned', { verdicts: 'not-read' }))).toBe('queued');
    expect(map(m, held('working')).verdicts).toBe('read');
  } },
  { name: 'row 9: a dispatched or working run reads working, in progress', run: (m) => {
    expect([status(m, held('dispatched')), status(m, held('working')), item(map(m, held('working')), 't1').group]).toEqual(['working', 'working', 'in-progress']);
  } },
  { name: 'row 10: a run in state unknown reads state-unknown', run: (m) => {
    expect([status(m, held('unknown')), item(map(m, held('unknown')), 't1').group]).toEqual(['state-unknown', 'in-progress']);
  } },
  { name: 'row 11: an awaiting-review run reads in-review', run: (m) => {
    expect(status(m, held('awaiting-review'))).toBe('in-review');
  } },
  { name: 'row 12: a merging or closing run reads merging', run: (m) => {
    expect([status(m, held('merging')), status(m, held('closing'))]).toEqual(['merging', 'merging']);
  } },
  { name: 'row 13: a planned run not blocked reads queued', run: (m) => {
    expect([status(m, held('planned')), status(m, held('planned', { verdicts: new Map([[7, { stuck: false, blockedBy: null }]]) }))]).toEqual(['queued', 'queued']);
  } },
  { name: 'row 14: an open ticket with no run reads not-started', run: (m) => {
    const v = map(m, { epics: [ep('e1', [tk('t1')])] });
    expect([item(v, 't1').status, item(v, 't1').group]).toEqual(['not-started', 'not-started']);
  } },
  { name: 'a failed run\'s ticket reads not-started with lastFailedRunId, the newest failed run', run: (m) => {
    const v = map(m, { epics: [ep('e1', [tk('t1')])], runs: [run(4, 'failed', { ticketKey: 't1' }), run(6, 'failed', { ticketKey: 't1' }), run(5, 'failed', { ticketKey: 't2' })] });
    expect([item(v, 't1').status, item(v, 't1').lastFailedRunId]).toEqual(['not-started', 6]);
  } },
  { name: 'a ticket with a run carries the run, its wave and its last move', run: (m) => {
    const v = map(m, { epics: [ep('e1', [tk('t1', { state: 'started', runId: 7 })])], runs: [run(7, 'working', { ticketKey: 't1', wave: 12, lastMoveAt: 4_000 })] });
    expect([item(v, 't1').runId, item(v, 't1').wave, item(v, 't1').lastMoveAt]).toEqual([7, 12, 4_000]);
  } },
  { name: 'a review run makes no row', run: (m) => {
    const v = map(m, { declared: false, runs: [run(4, 'working'), run(5, 'working', { kind: 'review' })] });
    expect(v.runs!.items.map((i) => i.runId)).toEqual([4]);
    expect(map(m, { epics: [ep('e1', [tk('t1')])], runs: [run(5, 'done', { kind: 'review' })] }).beforePlan).toBe(null);
  } },
  { name: 'a dropped ticket is in no total', run: (m) => {
    const v = map(m, { epics: [ep('e1', [tk('t1', { state: 'dropped' }), tk('t2')])], phases: [ph('p1', [eref('e1'), tref('t1')])] });
    expect(nz(v.counts)).toEqual(['not-started:1', 'dropped:1']);
    expect([phase(v, 'p1').items, nz(phase(v, 'p1').counts)]).toEqual([['t2'], ['not-started:1']]);
    expect([v.epics[0]!.total, v.epics[0]!.items]).toEqual([1, ['t2']]);
    expect([v.notInPhase, item(v, 't1').phases]).toEqual([[], []]);
  } },
  { name: 'a ticket held by a run the read did not return reads state-unknown', run: (m) => {
    expect(status(m, { epics: [ep('e1', [tk('t1', { state: 'started', runId: 7 })])], runs: [] })).toBe('state-unknown');
  } },
];

// ── Table 6a: how a phase reads its tickets ───────────────────────────────────────────────────────────────────────────

const twoPhases = (refsA: Ref[], refsB: Ref[], tickets: TicketView[], over: In = {}): In => ({
  epics: [ep('e1', tickets)], phases: [ph('pa', refsA), ph('pb', refsB)], ...over,
});

export const PHASE_CASES: WorkMapCase[] = [
  { name: '6a row 1: a dropped ticket is not shown in a phase and not counted', run: (m) => {
    const v = map(m, twoPhases([tref('t1')], [], [tk('t1', { state: 'dropped' })]));
    expect([phase(v, 'pa').items, nz(phase(v, 'pa').counts), phase(v, 'pa').finish]).toEqual([[], [], null]);
  } },
  { name: '6a row 2: a closed ticket reads closed in its phase, counted apart', run: (m) => {
    const v = map(m, twoPhases([tref('t1'), tref('t2')], [], [tk('t1'), tk('t2')], { closed: [['t1', 'why']] }));
    expect([phase(v, 'pa').items, nz(phase(v, 'pa').counts)]).toEqual([['t1', 't2'], ['not-started:1', 'closed:1']]);
  } },
  { name: '6a row 2 before row 3: a closed ticket carried out reads closed, not carried', run: (m) => {
    const v = map(m, twoPhases([tref('t1', 'pb', 100)], [tref('t1')], [tk('t1')], { closed: [['t1', 'why']] }));
    expect([phase(v, 'pa').carried, nz(phase(v, 'pa').counts)]).toEqual([0, ['closed:1']]);
  } },
  { name: '6a row 3: a recorded carry reads carried in the earlier phase and from it in the later one', run: (m) => {
    const v = map(m, twoPhases([tref('t1', 'pb', 100), tref('t2')], [tref('t1')], [tk('t1'), tk('t2')]));
    expect([phase(v, 'pa').carried, nz(phase(v, 'pa').counts), phase(v, 'pa').items]).toEqual([1, ['not-started:1'], ['t1', 't2']]);
    expect(nz(phase(v, 'pb').counts)).toEqual(['not-started:1']);
    expect(item(v, 't1').phases).toEqual([
      { key: 'pa', number: 1, carriedTo: { key: 'pb', number: 2 }, carriedFrom: [] },
      { key: 'pb', number: 2, carriedTo: null, carriedFrom: [{ key: 'pa', number: 1 }] },
    ]);
  } },
  { name: '6a row 3 before row 4: a carried ticket done later stays carried in the earlier phase', run: (m) => {
    const v = map(m, twoPhases([tref('t1', 'pb', 100)], [tref('t1')], [tk('t1', { state: 'done', runId: 5 })], {
      runs: [run(5, 'done', { ticketKey: 't1' })], done: [['t1', { at: 500, evidence: { runId: 5 } }]], evidence: [['t1', HOLDS]],
    }));
    expect([phase(v, 'pa').carried, nz(phase(v, 'pa').counts), nz(phase(v, 'pb').counts)]).toEqual([1, [], ['done:1']]);
  } },
  { name: '6a row 4: a done ticket counts as its phase\'s work, done', run: (m) => {
    const v = map(m, { ...doneT(), phases: [ph('pa', [tref('t1')])] });
    expect(nz(phase(v, 'pa').counts)).toEqual(['done:1']);
  } },
  { name: '6a row 4 before row 5: an ended plan\'s done ticket counts done in its phase', run: (m) => {
    const v = map(m, { ...doneT(HOLDS, { end: ENDED }), phases: [ph('pa', [tref('t1')])] });
    expect([nz(phase(v, 'pa').counts), phase(v, 'pa').finish]).toEqual([['done:1'], { at: 500 }]);
  } },
  { name: '6a row 5: an ended plan reads ended, its open tickets left-open in their own group and their phase not finished', run: (m) => {
    const v = map(m, { ...doneT(HOLDS, { end: ENDED }), epics: [ep('e1', [tk('t1', { state: 'done', runId: 5 }), tk('t2')])], phases: [ph('pa', [eref('e1')])] });
    expect([v.source, v.end, nz(v.counts)]).toEqual(['ended', ENDED, ['done:1', 'left-open:1']]);
    expect([nz(phase(v, 'pa').counts), phase(v, 'pa').finish]).toEqual([['done:1', 'left-open:1'], null]);
  } },
  { name: '6a row 6: anything else is outstanding in its phase, by its group', run: (m) => {
    const v = map(m, { ...held('working'), phases: [ph('pa', [tref('t1')])] });
    expect([nz(phase(v, 'pa').counts), phase(v, 'pa').finish]).toEqual([['in-progress:1'], null]);
  } },
  { name: 'a done-unverified ticket keeps its phase open', run: (m) => {
    const v = map(m, { ...doneT(BROKEN), phases: [ph('pa', [tref('t1')])] });
    expect([nz(phase(v, 'pa').counts), phase(v, 'pa').finish]).toEqual([['held:1'], null]);
  } },
  { name: 'one phase holds tickets of two epics', run: (m) => {
    const v = map(m, { epics: [ep('e1', [tk('t1')]), ep('e2', [tk('t2')])], phases: [ph('pa', [tref('t1'), tref('t2')])] });
    expect(phase(v, 'pa').items).toEqual(['t1', 't2']);
    expect([item(v, 't1').epic, item(v, 't2').epic]).toEqual([{ key: 'e1', title: 'Epic e1' }, { key: 'e2', title: 'Epic e2' }]);
  } },
  { name: 'a whole-epic reference takes a ticket added later and leaves out a dropped one', run: (m) => {
    const v = map(m, { epics: [ep('e1', [tk('t1'), tk('t2', { state: 'dropped' }), tk('t3', { source: 'worker' })])], phases: [ph('pa', [eref('e1')])] });
    expect([phase(v, 'pa').items, phase(v, 'pa').wholeEpics]).toEqual([['t1', 't3'], ['e1']]);
  } },
  { name: 'two whole-epic references keep a ticket outstanding in both and count it once', run: (m) => {
    const v = map(m, twoPhases([eref('e1')], [eref('e1')], [tk('t1')]));
    expect([nz(phase(v, 'pa').counts), nz(phase(v, 'pb').counts), nz(v.counts)]).toEqual([['not-started:1'], ['not-started:1'], ['not-started:1']]);
    expect(item(v, 't1').phases.map((p) => [p.key, p.carriedTo, p.carriedFrom])).toEqual([['pa', null, []], ['pb', null, []]]);
  } },
  { name: 'a ticket carried twice reads at each phase', run: (m) => {
    const v = map(m, { epics: [ep('e1', [tk('t1')])], phases: [ph('p1', [tref('t1', 'p2', 1)]), ph('p2', [tref('t1', 'p3', 2)]), ph('p3', [tref('t1')])] });
    expect(item(v, 't1').phases).toEqual([
      { key: 'p1', number: 1, carriedTo: { key: 'p2', number: 2 }, carriedFrom: [] },
      { key: 'p2', number: 2, carriedTo: { key: 'p3', number: 3 }, carriedFrom: [{ key: 'p1', number: 1 }] },
      { key: 'p3', number: 3, carriedTo: null, carriedFrom: [{ key: 'p2', number: 2 }] },
    ]);
  } },
  { name: 'a ticket carried into one phase from two names both', run: (m) => {
    const v = map(m, { epics: [ep('e1', [tk('t1')])], phases: [ph('p1', [tref('t1', 'p3', 1)]), ph('p2', [tref('t1', 'p3', 2)]), ph('p3', [tref('t1')])] });
    expect(item(v, 't1').phases[2]!.carriedFrom).toEqual([{ key: 'p1', number: 1 }, { key: 'p2', number: 2 }]);
  } },
  { name: 'a carry from a dropped source stands, its number null (review 2375 F10)', run: (m) => {
    const v = map(m, { epics: [ep('e1', [tk('t1')])], phases: [ph('p1', [tref('t1', 'p2', 1)], { dropped: true }), ph('p2', [tref('t1')])] });
    expect(item(v, 't1').phases).toEqual([{ key: 'p2', number: 1, carriedTo: null, carriedFrom: [{ key: 'p1', number: null }] }]);
  } },
  { name: 'a carry to a dropped phase is void', run: (m) => {
    const v = map(m, { epics: [ep('e1', [tk('t1')])], phases: [ph('p1', [tref('t1', 'p2', 1)]), ph('p2', [tref('t1')], { dropped: true })] });
    expect([phase(v, 'p1').carried, nz(phase(v, 'p1').counts), item(v, 't1').phases]).toEqual([0, ['not-started:1'], [{ key: 'p1', number: 1, carriedTo: null, carriedFrom: [] }]]);
    expect(v.phases.map((p) => p.key)).toEqual(['p1']);
  } },
  { name: 'a phase\'s count excludes its carried tickets', run: (m) => {
    const v = map(m, twoPhases([tref('t1', 'pb', 1), tref('t2'), tref('t3')], [tref('t1')], [tk('t1'), tk('t2'), tk('t3')]));
    expect([phase(v, 'pa').carried, nz(phase(v, 'pa').counts)]).toEqual([1, ['not-started:2']]);
  } },
  { name: 'a phase finishes at its latest own done or carry time', run: (m) => {
    const tickets = [tk('t1', { state: 'done', runId: 5 }), tk('t2', { state: 'done', runId: 6 }), tk('t3')];
    const v = map(m, twoPhases([tref('t1'), tref('t2'), tref('t3', 'pb', 900)], [tref('t3')], tickets, {
      done: [['t1', { at: 500, evidence: { runId: 5 } }], ['t2', { at: 700, evidence: { runId: 6 } }]], evidence: [['t1', HOLDS], ['t2', HOLDS]],
    }));
    expect([phase(v, 'pa').finish, phase(v, 'pb').finish]).toEqual([{ at: 900 }, null]);
    const w = map(m, twoPhases([tref('t1'), tref('t2'), tref('t3', 'pb', 300)], [tref('t3')], tickets, {
      done: [['t1', { at: 500, evidence: { runId: 5 } }], ['t2', { at: 700, evidence: { runId: 6 } }]], evidence: [['t1', HOLDS], ['t2', HOLDS]],
    }));
    expect(phase(w, 'pa').finish).toEqual({ at: 700 });
  } },
  { name: 'a finish with a missing time reads unknown', run: (m) => {
    const v = map(m, { ...doneT(HOLDS, { done: [['t1', { at: null, evidence: { runId: 5 } }]] }), phases: [ph('pa', [tref('t1')])] });
    expect(phase(v, 'pa').finish).toEqual({ at: 'unknown' });
    const w = map(m, twoPhases([tref('t1', 'pb', null)], [tref('t1')], [tk('t1')]));
    expect(phase(w, 'pa').finish).toEqual({ at: 'unknown' });
  } },
  { name: 'a phase that records only a carry out is finished at the carry', run: (m) => {
    const v = map(m, twoPhases([tref('t1', 'pb', 300)], [tref('t1')], [tk('t1')]));
    expect(phase(v, 'pa').finish).toEqual({ at: 300 });
  } },
  { name: 'an empty phase is not finished', run: (m) => {
    const v = map(m, twoPhases([], [tref('t1')], [tk('t1')]));
    expect([phase(v, 'pa').items, phase(v, 'pa').finish]).toEqual([[], null]);
  } },
  { name: 'a phase whose every reference reads as nothing is empty', run: (m) => {
    const v = map(m, { epics: [ep('e1', [tk('t1', { state: 'dropped' })], { state: 'dropped' }), ep('e2', [])], phases: [ph('pa', [eref('e1'), eref('e2'), tref('t1')])] });
    expect([phase(v, 'pa').items, phase(v, 'pa').finish, nz(phase(v, 'pa').counts)]).toEqual([[], null, []]);
  } },
  { name: 'a closed ticket alone does not finish its phase', run: (m) => {
    const v = map(m, twoPhases([tref('t1')], [], [tk('t1')], { closed: [['t1', 'why']] }));
    expect(phase(v, 'pa').finish).toBe(null);
  } },
  { name: 'phase and carry numbers come from phaseNumbers', run: (m) => {
    const v = map(m, { epics: [ep('e1', [tk('t1')])], phases: [ph('p0', [], { dropped: true }), ph('p1', [tref('t1', 'p2', 1)]), ph('p2', [tref('t1')])] });
    expect(v.phases.map((p) => [p.key, p.number])).toEqual([['p1', 1], ['p2', 2]]);
    expect(item(v, 't1').phases.map((p) => [p.key, p.number, p.carriedTo?.number ?? null])).toEqual([['p1', 1, 2], ['p2', 2, null]]);
  } },
  { name: 'a ticket in no phase goes to notInPhase', run: (m) => {
    const v = map(m, { epics: [ep('e1', [tk('t1'), tk('t2'), tk('t3', { state: 'dropped' })])], phases: [ph('pa', [tref('t1')])] });
    expect(v.notInPhase).toEqual(['t2']);
  } },
  { name: 'a plan with no phases still fills epics and items', run: (m) => {
    const v = map(m, { epics: [ep('e1', [tk('t1')]), ep('e2', [tk('t2')])] });
    expect([v.source, v.phases, v.notInPhase, v.items.map((i) => i.key), v.epics.map((e) => [e.key, e.items])])
      .toEqual(['plan', [], [], ['t1', 't2'], [['e1', ['t1']], ['e2', ['t2']]]]);
    expect(item(v, 't1').phases).toEqual([]);
  } },
];

// ── The strip, the four plan states and the fallback ─────────────────────────────────────────────────────────────────

export const VIEW_CASES: WorkMapCase[] = [
  { name: 'the epic strip counts each epic over every phase', run: (m) => {
    const v = map(m, { ...doneT(), epics: [ep('e1', [tk('t1', { state: 'done', runId: 5 }), tk('t2')]), ep('e2', [tk('t3')])],
      phases: [ph('pa', [tref('t1'), tref('t3')]), ph('pb', [eref('e1')])] });
    expect(v.epics.map((e) => [e.key, e.done, e.total])).toEqual([['e1', 1, 2], ['e2', 0, 1]]);
  } },
  { name: 'the strip\'s counts add up to the headline\'s', run: (m) => {
    const v = map(m, { ...doneT(), epics: [ep('e1', [tk('t1', { state: 'done', runId: 5 }), tk('t2'), tk('t4')]), ep('e2', [tk('t3')])],
      closed: [['t4', 'why']], phases: [ph('pa', [eref('e1')]), ph('pb', [eref('e1'), eref('e2')])] });
    const headDone = v.counts.done;
    const headTotal = v.counts.done + v.counts['in-progress'] + v.counts['waiting-on-you'] + v.counts.held + v.counts['not-started'];
    expect([v.epics.reduce((n, e) => n + e.done, 0), v.epics.reduce((n, e) => n + e.total, 0)]).toEqual([headDone, headTotal]);
    expect([headDone, headTotal, v.counts.closed]).toEqual([1, 3, 1]);
  } },
  { name: 'a dropped epic\'s done ticket stays in its whole-epic phase and on its chip', run: (m) => {
    const v = map(m, { ...doneT(), epics: [ep('e1', [tk('t1', { state: 'done', runId: 5 }), tk('t2', { state: 'dropped' })], { state: 'dropped' }), ep('e2', [tk('t3', { state: 'dropped' })], { state: 'dropped' })],
      phases: [ph('pa', [eref('e1')])] });
    expect([phase(v, 'pa').items, nz(phase(v, 'pa').counts)]).toEqual([['t1'], ['done:1']]);
    expect(v.epics.map((e) => [e.key, e.dropped, e.done, e.total])).toEqual([['e1', true, 1, 1]]);
  } },
  { name: 'checkpoints met and total leave out dropped checkpoints', run: (m) => {
    const cp = (key: string, state: 'open' | 'met' | 'dropped') => ({ key, title: key, kind: 'acceptance' as const, state, proves: [], metAt: state === 'met' ? 5 : null, evidence: state === 'met' ? { pr: 3 } : null, url: null, sync: 'none' as const, syncWord: null });
    const v = map(m, { epics: [ep('e1', [tk('t1')], { checkpoints: [cp('c1', 'met'), cp('c2', 'open'), cp('c3', 'dropped')] })] });
    expect([v.epics[0]!.checkpointsMet, v.epics[0]!.checkpointsTotal, v.epics[0]!.checkpoints.map((c) => c.key)]).toEqual([1, 2, ['c1', 'c2']]);
    expect(v.epics[0]!.checkpoints[0]).toEqual({ key: 'c1', title: 'c1', kind: 'acceptance', state: 'met', metAt: 5, evidence: { pr: 3 }, url: null });
  } },
  { name: 'an initiative per workspace, and the done-when list, as the plan carries them', run: (m) => {
    const initiatives = [{ workspaceId: 'w1', url: null, state: 'none' as const }, { workspaceId: 'w2', url: null, state: 'off' as const }];
    const doneWhen = [{ text: 'it works', proved: true }];
    const v = map(m, { epics: [ep('e1', [tk('t1')])], initiatives, doneWhen });
    expect([v.initiatives, v.doneWhen]).toEqual([initiatives, doneWhen]);
  } },
  { name: 'a run\'s own ticket folds into the declared ticket it is evidence of', run: (m) => {
    const v = map(m, {
      epics: [ep('e1', [tk('t1', { state: 'done' }), tk('run-5', { state: 'done', runId: 5, source: 'worker' }), tk('run-6', { state: 'done', runId: 6, source: 'worker' })])],
      runs: [run(5, 'done', { ticketKey: 'run-5' }), run(6, 'done', { ticketKey: 'run-6' })],
      done: [['t1', { at: 500, evidence: { runId: 5 } }], ['run-5', { at: 500, evidence: { runId: 5 } }], ['run-6', { at: 600, evidence: { runId: 6 } }]],
      evidence: [['t1', HOLDS], ['run-5', HOLDS], ['run-6', HOLDS]], phases: [ph('pa', [tref('t1'), tref('run-5')])],
    });
    expect(v.items.map((i) => i.key)).toEqual(['t1', 'run-6']);
    expect([v.counts.done, v.epics[0]!.total, phase(v, 'pa').items]).toEqual([2, 2, ['t1']]);
  } },
  { name: 'declared with nothing to count reads declared-empty', run: (m) => {
    const v = map(m, { epics: [ep('e1', [tk('t1', { state: 'dropped' })])], runs: [run(4, 'working')] });
    expect([v.source, v.runs]).toEqual(['declared-empty', null]);
    expect(map(m, { epics: [] }).source).toBe('declared-empty');
  } },
  { name: 'no plan: runs filled, no total, failed runs counted apart', run: (m) => {
    const v = map(m, { declared: false, runs: [run(3, 'done'), run(4, 'failed'), run(5, 'working', { lastMoveAt: 77 }), run(6, 'planned')], openItems: [{ id: 2, runId: 6 }] });
    expect([v.source, v.items, v.phases, v.epics, v.beforePlan]).toEqual(['runs', [], [], [], null]);
    expect(v.runs!.items.map((i) => [i.runId, i.status, i.group])).toEqual([
      [6, 'waiting-on-you', 'waiting-on-you'], [5, 'working', 'in-progress'], [4, 'failed', 'failed'], [3, 'done', 'done']]);
    expect([v.runs!.waves, nz(v.counts), v.runs!.items[1]!.lastMoveAt]).toEqual([{ from: 3, to: 6 }, ['done:1', 'in-progress:1', 'waiting-on-you:1', 'failed:1'], 77]);
    expect(map(m, { declared: false }).runs).toEqual({ items: [], waves: null });
  } },
  { name: 'a no-plan run row reads its stuck and blocked verdicts', run: (m) => {
    const v = map(m, { declared: false, runs: [run(5, 'working'), run(6, 'planned')], verdicts: new Map([[5, { stuck: true, blockedBy: null }], [6, { stuck: false, blockedBy: 5 }]]) });
    expect(v.runs!.items.map((i) => i.status)).toEqual(['blocked', 'stuck']);
  } },
  { name: 'runs with no ticket on a planned programme count in beforePlan', run: (m) => {
    const v = map(m, { epics: [ep('e1', [tk('t1', { state: 'started', runId: 9 })])], runs: [run(4, 'done'), run(5, 'failed'), run(9, 'working', { ticketKey: 't1' })] });
    expect([v.beforePlan, v.runs]).toEqual([{ runs: 2 }, null]);
  } },
  { name: 'a title equal to the programme\'s reads null', run: (m) => {
    const v = map(m, { declared: false, runs: [run(4, 'done', { runTitle: 'Prog A' }), run(5, 'done', { runTitle: null }), run(6, 'done', { runTitle: 'Build the thing' })] });
    expect(v.runs!.items.map((i) => [i.wave, i.title])).toEqual([[6, 'Build the thing'], [5, null], [4, null]]);
  } },
];

// ── The read side of the evidence rule ───────────────────────────────────────────────────────────────────────────────

const DONE_RUN: NonNullable<DoneEvidenceFacts['run']> = { program: 'prog-a', kind: 'work', state: 'done', ticketKey: 't1' };
const ev = (evidence: DoneEvidenceFacts['evidence'], over: Partial<DoneEvidenceFacts> = {}): DoneEvidenceFacts => ({
  program: 'prog-a', ticketKey: 't1', evidence, run: DONE_RUN, landed: null, ...over,
});
const holds = (m: WorkMapModule, f: DoneEvidenceFacts): string => { const v = m.doneEvidenceVerdict(f); return v.holds ? 'holds' : v.reason; };

export const EVIDENCE_CASES: WorkMapCase[] = [
  { name: 'evidence: a done work run of this programme that did this ticket holds', run: (m) => {
    expect(holds(m, ev({ runId: 5 }))).toBe('holds');
  } },
  { name: 'evidence: the run whose own ticket is an auto ticket, or none, holds', run: (m) => {
    expect([holds(m, ev({ runId: 5 }, { run: { ...DONE_RUN, ticketKey: 'run-5' } })), holds(m, ev({ runId: 5 }, { run: { ...DONE_RUN, ticketKey: null } }))]).toEqual(['holds', 'holds']);
  } },
  { name: 'evidence: a run whose own ticket is another declared one does not hold', run: (m) => {
    expect(holds(m, ev({ runId: 5 }, { run: { ...DONE_RUN, ticketKey: 't2' } }))).toBe('run 5 did ticket t2');
  } },
  { name: 'evidence: a run not recorded, of another programme, a review run, or not done does not hold', run: (m) => {
    expect([
      holds(m, ev({ runId: 5 }, { run: null })),
      holds(m, ev({ runId: 5 }, { run: { ...DONE_RUN, program: 'prog-b' } })),
      holds(m, ev({ runId: 5 }, { run: { ...DONE_RUN, kind: 'review' } })),
      holds(m, ev({ runId: 5 }, { run: { ...DONE_RUN, state: 'failed' } })),
    ]).toEqual(['run 5 is not recorded', 'run 5 is not a work run of this programme', 'run 5 is not a work run of this programme', 'run 5 is failed, not done']);
  } },
  { name: 'evidence: a pull request the landing line holds landed holds; any other answer does not', run: (m) => {
    expect([
      holds(m, ev({ pr: 12 }, { landed: { kind: 'landed' } })),
      holds(m, ev({ pr: 12 }, { landed: { kind: 'no-entry' } })),
      holds(m, ev({ pr: 12 }, { landed: null })),
      holds(m, ev({ pr: 12 }, { landed: { kind: 'unlanded', state: 'ejected' } })),
      holds(m, ev({ pr: 12 }, { landed: { kind: 'unreadable', detail: 'locked' } })),
    ]).toEqual(['holds', 'the landing line holds no pull request 12', 'the landing line holds no pull request 12', 'pull request 12 is ejected, not landed',
      'the landing line could not be read (locked)']);
  } },
  { name: 'evidence: stored evidence that cannot be read does not hold', run: (m) => {
    expect(holds(m, ev('malformed'))).toBe('the stored evidence cannot be read');
  } },
];

export const VERDICTS_CASES: WorkMapCase[] = [
  { name: 'verdicts: an absent or empty reader reads not-read, never "not stuck"', run: (m) => {
    expect([m.verdictsReadOf(undefined), m.verdictsReadOf(new Map())]).toEqual(['not-read', 'not-read']);
  } },
  { name: 'verdicts: a read reader gives each run its stuck verdict and what it waits behind', run: (m) => {
    const read = m.verdictsReadOf(new Map([[5, { stuck: { reason: 'x' }, blockedBy: null }], [6, { stuck: null, blockedBy: 5 }]]));
    expect(read === 'not-read' ? read : [...read]).toEqual([[5, { stuck: true, blockedBy: null }], [6, { stuck: false, blockedBy: 5 }]]);
  } },
];

export const WORK_MAP_CASES: WorkMapCase[] = [...STATUS_CASES, ...PHASE_CASES, ...VIEW_CASES, ...EVIDENCE_CASES, ...VERDICTS_CASES];
