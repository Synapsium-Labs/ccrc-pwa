// Programme work map WM0 (D-8715; spec 2026-11-16 §3, §7 D14, D15, D17, D18, and review 2268's F12): phases that reference
// epics and tickets, with recorded carries. The deciders' cases (`planPhasesCases.ts`) run here against the real
// `planPolicy.ts`; the rest drives `plan put`, `plan show` and `plan phase-ref` through the real server over a real coord.db.
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as policy from '../src/coord/planPolicy.js';
import type { PhaseView, PlanView } from '../../shared/plan.js';
import { PHASE_CASES } from './planPhasesCases.js';
import {
  buildCharacterizationPlans, charWorld, CHAR_TOKEN, openRun, planVerb, readCharacterizationPlans, ONE, SIX, type CharWorld,
} from './helpers/planPhasesFixture.js';

let w: CharWorld | undefined;
afterEach(async () => { if (w) await w.app.close(); w = undefined; });
const world = async (others: readonly string[] = []): Promise<CharWorld> => (w = await charWorld(others));

const view = (r: { json: () => unknown }): PlanView => (r.json() as { plan: PlanView }).plan;
const refusal = (r: { statusCode: number; json: () => unknown }) => {
  const b = r.json() as { error?: string; refused?: string };
  return [r.statusCode, b.error ?? b.refused];
};
const phaseOf = (v: PlanView, key: string): PhaseView => v.phases!.find((p) => p.key === key)!;
const refsOf = (v: PlanView, key: string) => phaseOf(v, key).refs.map((r) => `${r.kind}:${r.key}${r.carriedTo === null ? '' : `>${r.carriedTo}`}`);
const ph = (key: string, refs: { kind: 'epic' | 'ticket'; key: string }[] = [], over: Record<string, unknown> = {}) =>
  ({ key, title: `Phase ${key}`, summary: `the ${key} phase`, refs, ...over });
const t = (key: string) => ({ kind: 'ticket' as const, key });
const e = (key: string) => ({ kind: 'epic' as const, key });
const show = async (x: CharWorld, slug = 'prog-a') =>
  view(await x.app.inject({ method: 'GET', url: `/api/programmes/${slug}/plan`, headers: { 'x-ccrc-mail-token': CHAR_TOKEN } }));
const phaseRef = (x: CharWorld, body: unknown, who?: string) => who === undefined
  ? planVerb(x, 'prog-a', '/phases/refs', body)
  : x.app.inject({
    method: 'POST', url: `/api/programmes/prog-a/plan/phases/refs?byId=${who}&byUuid=u-${who}`,
    headers: { 'x-ccrc-mail-token': CHAR_TOKEN }, payload: body as never,
  });
/** The six-epic plan with three phases: p1 takes w0 whole and w1-t1, p2 w1-t1 and w1-t2, p3 nothing yet. */
const PHASED = { ...SIX, phases: [ph('p1', [e('w0'), t('w1-t1')]), ph('p2', [t('w1-t1'), t('w1-t2')]), ph('p3')] };

describe('the phase deciders (planPolicy.ts): every case of planPhasesCases.ts', () => {
  it.each(PHASE_CASES.map((c) => [c.name, c] as const))('%s', (_n, c) => { c.run(policy); });
});

describe('plan put stores phases (D14, D18)', () => {
  it('plan put stores phases in order with their references', async () => {
    const x = await world();
    const res = await planVerb(x, 'prog-a', '', PHASED);
    expect(res.statusCode, res.body).toBe(200);
    const v = view(res);
    expect(v.phases!.map((p) => [p.key, p.number, p.title, p.summary, p.dropped])).toEqual([
      ['p1', 1, 'Phase p1', 'the p1 phase', false], ['p2', 2, 'Phase p2', 'the p2 phase', false], ['p3', 3, 'Phase p3', 'the p3 phase', false],
    ]);
    expect([refsOf(v, 'p1'), refsOf(v, 'p2'), refsOf(v, 'p3')]).toEqual([['epic:w0', 'ticket:w1-t1'], ['ticket:w1-t1', 'ticket:w1-t2'], []]);
  });

  it('a phase\'s number counts only phases not dropped', async () => {
    const x = await world();
    await planVerb(x, 'prog-a', '', PHASED);
    const res = await planVerb(x, 'prog-a', '', { ...SIX, phases: [ph('p1', [], { droppedWhy: 'merged into p2' }), ph('p2'), ph('p3')] });
    expect(res.statusCode, res.body).toBe(200);
    expect(view(res).phases!.map((p) => [p.key, p.number, p.dropped])).toEqual([['p1', null, true], ['p2', 1, false], ['p3', 2, false]]);
  });

  it('a put with no phases key leaves the stored phases', async () => {
    const x = await world();
    await planVerb(x, 'prog-a', '', PHASED);
    expect((await planVerb(x, 'prog-a', '', SIX)).statusCode).toBe(200);
    const v = await show(x);
    expect(v.phases!.map((p) => p.key)).toEqual(['p1', 'p2', 'p3']);
    expect(refsOf(v, 'p1')).toEqual(['epic:w0', 'ticket:w1-t1']);
  });

  it('a put adds references and never removes one', async () => {
    const x = await world();
    await planVerb(x, 'prog-a', '', PHASED);
    const res = await planVerb(x, 'prog-a', '', { ...SIX, phases: [ph('p1', [t('w2-t1')]), ph('p2'), ph('p3', [e('w3')])] });
    expect(res.statusCode, res.body).toBe(200);
    expect([refsOf(view(res), 'p1'), refsOf(view(res), 'p2'), refsOf(view(res), 'p3')])
      .toEqual([['epic:w0', 'ticket:w1-t1', 'ticket:w2-t1'], ['ticket:w1-t1', 'ticket:w1-t2'], ['epic:w3']]);
  });

  it('a phase may reference a whole epic and a ticket', async () => {
    const x = await world();
    expect(refsOf(view(await planVerb(x, 'prog-a', '', PHASED)), 'p1')).toEqual(['epic:w0', 'ticket:w1-t1']);
  });

  it('one ticket may be referenced by two phases', async () => {
    const x = await world();
    const v = view(await planVerb(x, 'prog-a', '', PHASED));
    expect([refsOf(v, 'p1').includes('ticket:w1-t1'), refsOf(v, 'p2').includes('ticket:w1-t1')]).toEqual([true, true]);
  });

  it('a new reference to an unknown or dropped object is refused unknown-ref, and stores nothing', async () => {
    const x = await world();
    await planVerb(x, 'prog-a', '', PHASED);
    await planVerb(x, 'prog-a', '/tickets/move', { ticket: 'w4-t4', drop: { why: 'not needed' } });
    for (const refs of [[t('w4-t4')], [t('nope')], [e('nope')]]) {
      const r = await planVerb(x, 'prog-a', '', { ...SIX, phases: [ph('p1'), ph('p2'), ph('p3', refs)] });
      expect(refusal(r), JSON.stringify(refs)).toEqual([404, 'unknown-ref']);
    }
    expect(refsOf(await show(x), 'p3')).toEqual([]);
  });

  it('a reference stored before its ticket dropped is kept', async () => {
    const x = await world();
    await planVerb(x, 'prog-a', '', { ...PHASED, phases: [ph('p1', [t('w4-t4')]), ph('p2'), ph('p3')] });
    expect((await planVerb(x, 'prog-a', '/tickets/move', { ticket: 'w4-t4', drop: { why: 'not needed' } })).statusCode).toBe(200);
    const again = await planVerb(x, 'prog-a', '', { ...SIX, phases: [ph('p1', [t('w4-t4')]), ph('p2'), ph('p3')] });
    expect(again.statusCode, again.body).toBe(200);
    expect(refsOf(view(again), 'p1')).toEqual(['ticket:w4-t4']);
  });

  it('dropping a phase needs a reason and leaves its tickets alone', async () => {
    const x = await world();
    await planVerb(x, 'prog-a', '', PHASED);
    const before = x.plan.planOf('prog-a');
    expect(refusal(await planVerb(x, 'prog-a', '', { ...SIX, phases: [ph('p1'), ph('p3')] }))).toEqual([400, 'dropped-needs-reason']);
    const res = await planVerb(x, 'prog-a', '', { ...SIX, phases: [ph('p1'), ph('p2', [], { droppedWhy: 'folded into p3' }), ph('p3')] });
    expect(res.statusCode, res.body).toBe(200);
    expect(phaseOf(view(res), 'p2')).toMatchObject({ dropped: true, number: null, refs: [{ kind: 'ticket', key: 'w1-t1' }, { kind: 'ticket', key: 'w1-t2' }] });
    expect(x.plan.planOf('prog-a')).toEqual(before);
  });

  it('more than 24 phases is plan-too-large; a phase key repeated or a reference of an unknown kind is plan-bad-body', async () => {
    const x = await world();
    const many = Array.from({ length: 25 }, (_, i) => ph(`p${i}`));
    expect(refusal(await planVerb(x, 'prog-a', '', { ...SIX, phases: many }))).toEqual([400, 'plan-too-large']);
    expect(refusal(await planVerb(x, 'prog-a', '', { ...SIX, phases: [ph('p1'), ph('p1')] }))).toEqual([400, 'plan-bad-body']);
    expect(refusal(await planVerb(x, 'prog-a', '', { ...SIX, phases: [ph('p1', [{ kind: 'wave', key: 'w0' } as never])] }))).toEqual([400, 'plan-bad-body']);
  });

  it('a put that orders a carry\'s target before its source is refused bad-carry (F12)', async () => {
    const x = await world();
    await planVerb(x, 'prog-a', '', PHASED);
    expect((await phaseRef(x, { op: 'carry', from: 'p1', to: 'p3', ticket: 'w0-t2' })).statusCode).toBe(200);
    expect(refusal(await planVerb(x, 'prog-a', '', { ...SIX, phases: [ph('p3'), ph('p1'), ph('p2')] }))).toEqual([409, 'bad-carry']);
    expect((await show(x)).phases!.map((p) => p.key)).toEqual(['p1', 'p2', 'p3']);
  });
});

describe('plan phase-ref (D17, F12)', () => {
  it('phase-ref adds and removes one reference', async () => {
    const x = await world();
    await planVerb(x, 'prog-a', '', PHASED);
    const added = await phaseRef(x, { op: 'add', phase: 'p3', ref: t('w2-t1') });
    expect(added.statusCode, added.body).toBe(200);
    expect(refsOf(view(added), 'p3')).toEqual(['ticket:w2-t1']);
    const removed = await phaseRef(x, { op: 'remove', phase: 'p1', ref: e('w0') });
    expect(removed.statusCode, removed.body).toBe(200);
    expect(refsOf(view(removed), 'p1')).toEqual(['ticket:w1-t1']);
  });

  it('phase-ref carries a ticket and records the time', async () => {
    const x = await world();
    await planVerb(x, 'prog-a', '', PHASED);
    const res = await phaseRef(x, { op: 'carry', from: 'p2', to: 'p3', ticket: 'w1-t2' });
    expect(res.statusCode, res.body).toBe(200);
    const v = view(res);
    expect(phaseOf(v, 'p2').refs.find((r) => r.key === 'w1-t2')).toMatchObject({ carriedTo: 'p3' });
    expect(typeof phaseOf(v, 'p2').refs.find((r) => r.key === 'w1-t2')!.carriedAt).toBe('number');
    expect(refsOf(v, 'p3')).toEqual(['ticket:w1-t2']);
  });

  it('a carry out of a whole-epic reference is stored on a ticket reference', async () => {
    const x = await world();
    await planVerb(x, 'prog-a', '', PHASED);
    const v = view(await phaseRef(x, { op: 'carry', from: 'p1', to: 'p2', ticket: 'w0-t3' }));
    expect(refsOf(v, 'p1')).toEqual(['epic:w0', 'ticket:w1-t1', 'ticket:w0-t3>p2']);
    expect(refsOf(v, 'p2')).toEqual(['ticket:w1-t1', 'ticket:w1-t2', 'ticket:w0-t3']);
  });

  it('each bad-carry case is refused, and changes nothing', async () => {
    const x = await world();
    await planVerb(x, 'prog-a', '', { ...PHASED, phases: [...PHASED.phases, ph('pd', [t('w2-t1')])] });
    await planVerb(x, 'prog-a', '', { ...SIX, phases: [...PHASED.phases, ph('pd', [], { droppedWhy: 'cut' })] });
    const a1 = await openRun(x, { title: 'a', project: 'project-a', waveOf: 6, homeProject: 'project-a', program: 'prog-a', wave: 1, ticket: 'w0-t1' });
    for (const to of ['dispatched', 'closing', 'done'] as const) expect(x.coord.advance((a1.json() as { id: number }).id, to, 'test').ok).toBe(true);
    const before = await show(x);
    for (const [why, body] of [
      ['the from phase is dropped', { op: 'carry', from: 'pd', to: 'p3', ticket: 'w2-t1' }],
      ['the to phase is dropped', { op: 'carry', from: 'p1', to: 'pd', ticket: 'w1-t1' }],
      ['the to phase is not later', { op: 'carry', from: 'p2', to: 'p1', ticket: 'w1-t2' }],
      ['the ticket is done', { op: 'carry', from: 'p1', to: 'p2', ticket: 'w0-t1' }],
      ['the ticket is not the from phase\'s work', { op: 'carry', from: 'p1', to: 'p2', ticket: 'w3-t1' }],
    ] as const) {
      expect(refusal(await phaseRef(x, body)), why).toEqual([409, 'bad-carry']);
    }
    expect(await show(x)).toEqual(before);
  });

  it('removing either end of a recorded carry is refused bad-carry; removing any other reference is allowed', async () => {
    const x = await world();
    await planVerb(x, 'prog-a', '', PHASED);
    expect((await phaseRef(x, { op: 'carry', from: 'p2', to: 'p3', ticket: 'w1-t2' })).statusCode).toBe(200);
    expect(refusal(await phaseRef(x, { op: 'remove', phase: 'p2', ref: t('w1-t2') }))).toEqual([409, 'bad-carry']);
    expect(refusal(await phaseRef(x, { op: 'remove', phase: 'p3', ref: t('w1-t2') }))).toEqual([409, 'bad-carry']);
    expect((await phaseRef(x, { op: 'remove', phase: 'p2', ref: t('w1-t1') })).statusCode).toBe(200);
    expect(refsOf(await show(x), 'p2')).toEqual(['ticket:w1-t2>p3']);
  });

  it('add and remove refuse an unknown or dropped phase, and an unknown object, with unknown-ref', async () => {
    const x = await world();
    await planVerb(x, 'prog-a', '', { ...SIX, phases: [...PHASED.phases, ph('pd', [], { droppedWhy: 'cut' })] });
    expect(refusal(await phaseRef(x, { op: 'add', phase: 'pd', ref: t('w2-t1') }))).toEqual([404, 'unknown-ref']);
    expect(refusal(await phaseRef(x, { op: 'add', phase: 'nope', ref: t('w2-t1') }))).toEqual([404, 'unknown-ref']);
    expect(refusal(await phaseRef(x, { op: 'add', phase: 'p1', ref: t('nope') }))).toEqual([404, 'unknown-ref']);
    expect(refusal(await phaseRef(x, { op: 'remove', phase: 'p3', ref: t('w2-t1') }))).toEqual([404, 'unknown-ref']);
  });

  it('phase-ref refuses a caller that is not the coordinator', async () => {
    const x = await world(['coord-b']);
    await planVerb(x, 'prog-a', '', PHASED);
    const r = await phaseRef(x, { op: 'add', phase: 'p3', ref: t('w2-t1') }, 'coord-b');
    expect(refusal(r)).toEqual([403, 'not-plan-owner']);
    expect(refsOf(await show(x), 'p3')).toEqual([]);
  });

  it('a body naming byId is refused', async () => {
    const x = await world();
    await planVerb(x, 'prog-a', '', PHASED);
    expect(refusal(await phaseRef(x, { op: 'add', phase: 'p3', ref: t('w2-t1'), byId: 'coord-a' }))).toEqual([400, 'plan-bad-body']);
    expect(refusal(await phaseRef(x, { op: 'move', phase: 'p3' }))).toEqual([400, 'plan-bad-body']);
  });

  it('phase-ref refuses plan-closed after the plan ends', async () => {
    const x = await world();
    await planVerb(x, 'prog-a', '', PHASED);
    expect((await planVerb(x, 'prog-a', '/close', { outcome: 'done' })).statusCode).toBe(200);
    expect(refusal(await phaseRef(x, { op: 'add', phase: 'p3', ref: t('w2-t1') }))).toEqual([409, 'plan-closed']);
  });
});

describe('the acceptance: stored plans and runs open, as before WM0', () => {
  const FIXTURE = fileURLToPath(new URL('./fixtures/plan-phases/characterization.json', import.meta.url));

  it('the stored plans read the same as before', async () => {
    const x = await world();
    await buildCharacterizationPlans(x);
    expect(await readCharacterizationPlans(x)).toEqual(JSON.parse(readFileSync(FIXTURE, 'utf8')));
  });

  // WM0 opened every run as before; WM1 (D-8727, spec §4.1 D10) changes exactly one thing here: in a phased plan, a run with
  // no ticket into an epic that holds an open declared ticket no run holds is refused `ticket-required`, and naming one opens it.
  it('runs open in a phased plan: a named ticket opens as before, and a run with no ticket names one (WM1\'s ticket-required)', async () => {
    const x = await world();
    await buildCharacterizationPlans(x);
    expect((await planVerb(x, 'prog-a', '', { ...SIX, phases: [ph('p1', [e('w5')]), ph('p2', [e('w4')])] })).statusCode).toBe(200);
    expect((await planVerb(x, 'prog-b', '', { ...ONE, phases: [ph('p1', [e('only')])] })).statusCode).toBe(200);
    const base = { title: 'later', project: 'project-a', waveOf: 6, homeProject: 'project-a' };
    const named = await openRun(x, { ...base, program: 'prog-a', wave: 6, ticket: 'w5-t1' });
    const bare = await openRun(x, { ...base, title: 'later, no ticket', program: 'prog-a', wave: 5 });
    const b2 = await openRun(x, { ...base, program: 'prog-b', wave: 2, waveOf: 2 });
    const word = (r: { json: () => unknown }) => (r.json() as { refused?: string }).refused;
    expect([named.statusCode, bare.statusCode, b2.statusCode, word(bare), word(b2)], `${named.body} ${bare.body} ${b2.body}`)
      .toEqual([200, 409, 409, 'ticket-required', 'ticket-required']);
    const bareNamed = await openRun(x, { ...base, title: 'later, named', program: 'prog-a', wave: 5, ticket: 'w4-t1' });
    const b2Named = await openRun(x, { ...base, program: 'prog-b', wave: 2, waveOf: 2, ticket: 'only-t2' });
    expect([bareNamed.statusCode, b2Named.statusCode], `${bareNamed.body} ${b2Named.body}`).toEqual([200, 200]);
    const held = (k: string) => x.plan.planOf('prog-a').epics.find((ep) => ep.key === k)!.tickets.filter((tk) => tk.runId !== null).map((tk) => tk.key);
    expect([held('w5'), held('w4')]).toEqual([['w5-t1'], ['w4-t1']]);
  });
});
