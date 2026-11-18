// Programme work map WM1 (D-8727; spec 2026-11-16 §4.1, D10): in a plan that declares at least one phase, a work run that
// opens with no `ticket` into an epic with an open declared ticket no run holds is refused `ticket-required`, after
// `wave-epic-mismatch`. A plan with no phases opens it as today, and review runs are untouched. The decider's cases
// (`planTicketDoneCases.ts`'s REQUIRED_CASES) run here against the real `planPolicy.ts`; the rest drives `POST /api/runs`
// through the real server over a real coord.db (fixture HOME only).
import { describe, it, expect, afterEach } from 'vitest';
import * as policy from '../src/coord/planPolicy.js';
import { REQUIRED_CASES } from './planTicketDoneCases.js';
import { charWorld, openRun, planVerb, type CharWorld } from './helpers/planPhasesFixture.js';

let w: CharWorld | undefined;
afterEach(async () => { if (w) await w.app.close(); w = undefined; });
const world = async (): Promise<CharWorld> => (w = await charWorld());

const refusal = (r: { statusCode: number; json: () => unknown }) => {
  const b = r.json() as { error?: string; refused?: string };
  return [r.statusCode, b.error ?? b.refused];
};
const idOf = (r: { json: () => unknown }): number => (r.json() as { id: number }).id;
const BASE = { title: 'a wave', project: 'project-a', waveOf: 3, homeProject: 'project-a', program: 'prog-a' };
const ticket = (key: string) => ({ key, kind: 'work', title: `ticket ${key}` });
/** e1 (wave 1) holds `tickets`; e2 (wave 2) holds none. With `phased`, one phase takes both epics whole. */
const plan = (tickets: string[], phased: boolean) => ({
  home: 'project-a',
  ...(phased ? { phases: [{ key: 'p1', title: 'Phase one', summary: 'all of it', refs: [{ kind: 'epic', key: 'e1' }, { kind: 'epic', key: 'e2' }] }] } : {}),
  epics: [
    { key: 'e1', title: 'E1', summary: 's', waves: [1], checkpoints: [], tickets: tickets.map(ticket) },
    { key: 'e2', title: 'E2', summary: 's', waves: [2], checkpoints: [] },
  ],
});
const ticketsOf = (x: CharWorld) => x.plan.planOf('prog-a').epics.flatMap((e) => e.tickets.map((t) => [t.key, t.state, t.runId]));

describe('the ticket-required decider (planPolicy.ts): REQUIRED_CASES of planTicketDoneCases.ts', () => {
  it.each(REQUIRED_CASES.map((c) => [c.name, c] as const))('%s', (_n, c) => { c.run(policy); });
});

describe('runs open names its ticket in a phased plan (D10)', () => {
  it('in a phased plan, a run with no ticket into an epic with an open declared ticket is refused ticket-required', async () => {
    const x = await world();
    expect((await planVerb(x, 'prog-a', '', plan(['t1', 't2'], true))).statusCode).toBe(200);
    expect(refusal(await openRun(x, { ...BASE, wave: 1 }))).toEqual([409, 'ticket-required']);
    // nothing was opened and no auto ticket minted
    const rr = x.coord.runs();
    expect(rr.ok ? rr.runs : rr).toEqual([]);
    expect(ticketsOf(x)).toEqual([['t1', 'open', null], ['t2', 'open', null]]);
    // naming the ticket opens it
    const named = await openRun(x, { ...BASE, wave: 1, ticket: 't1' });
    expect(named.statusCode, named.body).toBe(200);
  });

  it('a plan whose only phase is dropped is still phased: the phase was declared (phased-counts-dropped; review 2429 F8)', async () => {
    const x = await world();
    expect((await planVerb(x, 'prog-a', '', plan(['t1'], true))).statusCode).toBe(200);
    const p = { ...plan(['t1'], false), phases: [{ key: 'p1', title: 'Phase one', summary: 'all of it', refs: [], droppedWhy: 'cut' }] };
    const res = await planVerb(x, 'prog-a', '', p);
    expect(res.statusCode, res.body).toBe(200);
    expect(x.plan.phasesOf('prog-a').map((ph) => [ph.key, ph.droppedWhy !== null])).toEqual([['p1', true]]);
    expect(refusal(await openRun(x, { ...BASE, wave: 1 }))).toEqual([409, 'ticket-required']);
  });

  it('wave-epic-mismatch is answered first', async () => {
    const x = await world();
    await planVerb(x, 'prog-a', '', plan(['t1'], true));
    expect(refusal(await openRun(x, { ...BASE, wave: 9 }))).toEqual([409, 'wave-epic-mismatch']);
  });

  it('a plan with no phases opens it as today', async () => {
    const x = await world();
    await planVerb(x, 'prog-a', '', plan(['t1', 't2'], false));
    const r = await openRun(x, { ...BASE, wave: 1 });
    expect(r.statusCode, r.body).toBe(200);
    expect(ticketsOf(x)).toContainEqual([`run-${idOf(r)}`, 'open', idOf(r)]);
  });

  it('an epic with only auto tickets open admits it', async () => {
    const x = await world();
    await planVerb(x, 'prog-a', '', plan([], true));
    const first = await openRun(x, { ...BASE, wave: 1 });
    expect(first.statusCode, first.body).toBe(200);
    for (const to of ['dispatched', 'failed'] as const) expect(x.coord.advance(idOf(first), to, 'test').ok).toBe(true);
    expect(ticketsOf(x)).toEqual([[`run-${idOf(first)}`, 'open', null]]);
    const again = await openRun(x, { ...BASE, wave: 1 });
    expect(again.statusCode, again.body).toBe(200);
  });

  it('a declared ticket a run holds does not count', async () => {
    const x = await world();
    await planVerb(x, 'prog-a', '', plan(['t1'], true));
    expect((await openRun(x, { ...BASE, wave: 1, ticket: 't1' })).statusCode).toBe(200);
    const bare = await openRun(x, { ...BASE, title: 'another', wave: 1 });
    expect(bare.statusCode, bare.body).toBe(200);
  });

  it('an epic with no tickets admits it', async () => {
    const x = await world();
    await planVerb(x, 'prog-a', '', plan(['t1'], true));
    const r = await openRun(x, { ...BASE, wave: 2 });
    expect(r.statusCode, r.body).toBe(200);
  });

  it('a review run is never refused', async () => {
    const x = await world();
    await planVerb(x, 'prog-a', '', plan(['t1', 't2'], true));
    const work = await openRun(x, { ...BASE, wave: 1, ticket: 't1' });
    for (const to of ['dispatched', 'working', 'awaiting-review'] as const) expect(x.coord.advance(idOf(work), to, 'test').ok).toBe(true);
    const review = await openRun(x, { kind: 'review', reviews: idOf(work), program: 'prog-a', title: 'Review', homeProject: 'project-a' });
    expect(review.statusCode, review.body).toBe(200);
  });
});
