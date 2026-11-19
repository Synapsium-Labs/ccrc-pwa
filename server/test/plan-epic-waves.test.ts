// Programme work map WM6 (D-8780; spec 2026-11-16 Q5, the operator's yes, R133): an epic may run without a wave range. A
// plan's `waves` is optional on the wire (read through `listedWaves`, the one reader); `waves-not-contiguous` and
// `wave-overlap` are checked among the epics that list waves; `planGate` takes a named ticket's epic and checks the wave
// against it only when that epic lists waves; and a run with no ticket whose wave no epic lists, in a plan where a live epic
// lists none, is refused `ticket-required`, not `wave-epic-mismatch`. Every plan whose epics all list waves opens and refuses
// exactly as before (the acceptance), shown by the last describe. Drives the real server over a real coord.db, fixture HOME only.
import { describe, it, expect, afterEach } from 'vitest';
import { listedWaves } from '../src/coord/planPolicy.js';
import { charWorld, openRun, planVerb, type CharWorld } from './helpers/planPhasesFixture.js';

let w: CharWorld | undefined;
afterEach(async () => { if (w) await w.app.close(); w = undefined; });
const world = async (): Promise<CharWorld> => (w = await charWorld());

const refusal = (r: { statusCode: number; json: () => unknown }) => {
  const b = r.json() as { error?: string; refused?: string };
  return [r.statusCode, b.error ?? b.refused];
};
const BASE = { title: 'a wave', project: 'project-a', waveOf: 3, homeProject: 'project-a', program: 'prog-a' };
const ticket = (key: string) => ({ key, kind: 'work', title: `ticket ${key}` });
/** An epic body; `waves` left out lists none (the wire's optional field). */
const epic = (key: string, waves?: number[], tickets: string[] = []) => ({
  key, title: key.toUpperCase(), summary: 's', ...(waves === undefined ? {} : { waves }), checkpoints: [], tickets: tickets.map(ticket),
});
const put = (...epics: unknown[]) => ({ home: 'project-a', epics });
const wavesOf = (x: CharWorld) => x.plan.planOf('prog-a').epics.map((e) => [e.key, e.waves]);

describe('the one reader of an epic\'s waves (planPolicy.ts)', () => {
  it('an absent list and an empty one both list no waves', () => {
    expect(listedWaves({})).toEqual([]);
    expect(listedWaves({ waves: [] })).toEqual([]);
    expect(listedWaves({ waves: [2, 3] })).toEqual([2, 3]);
  });
});

describe('plan put: an epic may list no waves', () => {
  it('an epic with no waves is accepted', async () => {
    const x = await world();
    const r = await planVerb(x, 'prog-a', '', put(epic('free')));
    expect(r.statusCode, r.body).toBe(200);
    expect(wavesOf(x)).toEqual([['free', []]]);
    // an explicit empty list is the same thing
    const again = await planVerb(x, 'prog-a', '', put(epic('free', [])));
    expect(again.statusCode, again.body).toBe(200);
    expect(wavesOf(x)).toEqual([['free', []]]);
  });

  it('two epics with no waves run side by side', async () => {
    const x = await world();
    const r = await planVerb(x, 'prog-a', '', put(epic('free-a', undefined, ['a1']), epic('free-b', undefined, ['b1']), epic('ranged', [1, 2])));
    expect(r.statusCode, r.body).toBe(200);
    expect(wavesOf(x)).toEqual([['free-a', []], ['free-b', []], ['ranged', [1, 2]]]);
    // each opens a run on its own ticket, whatever wave the run is
    const a = await openRun(x, { ...BASE, wave: 7, ticket: 'a1' });
    const b = await openRun(x, { ...BASE, wave: 7, ticket: 'b1' });
    expect([a.statusCode, b.statusCode], `${a.body} ${b.body}`).toEqual([200, 200]);
  });

  it('an epic that lists waves keeps waves-not-contiguous and wave-overlap, beside one that lists none', async () => {
    const x = await world();
    expect(refusal(await planVerb(x, 'prog-a', '', put(epic('free'), epic('gap', [1, 3]))))).toEqual([400, 'waves-not-contiguous']);
    expect(refusal(await planVerb(x, 'prog-a', '', put(epic('free'), epic('one', [1, 2]), epic('two', [2, 3]))))).toEqual([409, 'wave-overlap']);
    // nothing was stored by either refusal
    expect(wavesOf(x)).toEqual([]);
  });

  it('a put that omits the waves of a stored epic leaves it with no waves', async () => {
    const x = await world();
    expect((await planVerb(x, 'prog-a', '', put(epic('free', [1])))).statusCode).toBe(200);
    expect((await planVerb(x, 'prog-a', '', put(epic('free')))).statusCode).toBe(200);
    expect(wavesOf(x)).toEqual([['free', []]]);
  });

  it('waves that are not a list of wave numbers are still refused plan-bad-body', async () => {
    const x = await world();
    expect(refusal(await planVerb(x, 'prog-a', '', put({ ...epic('free'), waves: 'all' })))).toEqual([400, 'plan-bad-body']);
    expect(refusal(await planVerb(x, 'prog-a', '', put({ ...epic('free'), waves: [-1] })))).toEqual([400, 'plan-bad-body']);
  });
});

describe('runs open into an epic that lists no waves', () => {
  it('a run naming a ticket of an epic with no waves opens, at any wave', async () => {
    const x = await world();
    expect((await planVerb(x, 'prog-a', '', put(epic('free', undefined, ['t1', 't2']), epic('ranged', [1])))).statusCode).toBe(200);
    const r = await openRun(x, { ...BASE, wave: 9, ticket: 't1' });
    expect(r.statusCode, r.body).toBe(200);
    expect(x.plan.planOf('prog-a').epics.flatMap((e) => e.tickets.map((t) => [e.key, t.key, t.state, t.runId !== null])))
      .toEqual([['free', 't1', 'open', true], ['free', 't2', 'open', false]]);
  });

  it('a ticket another run holds is refused ticket-unavailable, as before; a ticket that is missing is not an epic\'s, so wave-epic-mismatch', async () => {
    const x = await world();
    await planVerb(x, 'prog-a', '', put(epic('free', undefined, ['t1'])));
    expect((await openRun(x, { ...BASE, wave: 9, ticket: 't1' })).statusCode).toBe(200);
    // a second run (another wave; the same wave would be the first open retried) cannot take the held ticket
    expect(refusal(await openRun(x, { ...BASE, wave: 10, ticket: 't1' }))).toEqual([409, 'ticket-unavailable']);
    // a ticket that is no ticket names no epic: no epic lists the wave, so the wave's own refusal answers, as it always did
    expect(refusal(await openRun(x, { ...BASE, wave: 11, ticket: 'nope' }))).toEqual([409, 'wave-epic-mismatch']);
  });

  it('a run with no ticket into a plan with an epic of no waves is refused ticket-required, not wave-epic-mismatch', async () => {
    const x = await world();
    await planVerb(x, 'prog-a', '', put(epic('free', undefined, ['t1']), epic('ranged', [1])));
    expect(refusal(await openRun(x, { ...BASE, wave: 9 }))).toEqual([409, 'ticket-required']);
    // nothing was opened
    const rr = x.coord.runs();
    expect(rr.ok ? rr.runs : rr).toEqual([]);
    // a wave an epic does list still opens with no ticket, as before
    expect((await openRun(x, { ...BASE, wave: 1 })).statusCode).toBe(200);
  });

  it('a dropped epic of no waves does not turn the refusal into ticket-required', async () => {
    const x = await world();
    await planVerb(x, 'prog-a', '', put(epic('free'), epic('ranged', [1])));
    expect((await planVerb(x, 'prog-a', '', put({ ...epic('free'), droppedWhy: 'cut' }, epic('ranged', [1])))).statusCode).toBe(200);
    expect(refusal(await openRun(x, { ...BASE, wave: 9 }))).toEqual([409, 'wave-epic-mismatch']);
  });
});

describe('every plan whose epics all list waves opens runs exactly as before (the acceptance)', () => {
  const ALL = () => put(epic('e1', [1], ['t1']), epic('e2', [2, 3], ['t2']));

  it('keeps wave-epic-mismatch for a wave no epic lists, with and without a ticket', async () => {
    const x = await world();
    expect((await planVerb(x, 'prog-a', '', ALL())).statusCode).toBe(200);
    expect(refusal(await openRun(x, { ...BASE, wave: 9 }))).toEqual([409, 'wave-epic-mismatch']);
    expect(refusal(await openRun(x, { ...BASE, wave: 9, ticket: 't1' }))).toEqual([409, 'wave-epic-mismatch']);
    expect(refusal(await openRun(x, { ...BASE, wave: 9, ticket: 'nope' }))).toEqual([409, 'wave-epic-mismatch']);
  });

  it('keeps wave-epic-mismatch for a ticket of another epic than the wave\'s', async () => {
    const x = await world();
    await planVerb(x, 'prog-a', '', ALL());
    expect(refusal(await openRun(x, { ...BASE, wave: 2, ticket: 't1' }))).toEqual([409, 'wave-epic-mismatch']);
  });

  it('opens a wave an epic lists, with its ticket and with none', async () => {
    const x = await world();
    await planVerb(x, 'prog-a', '', ALL());
    const named = await openRun(x, { ...BASE, wave: 3, ticket: 't2' });
    expect(named.statusCode, named.body).toBe(200);
    const auto = await openRun(x, { ...BASE, wave: 1 });
    expect(auto.statusCode, auto.body).toBe(200);
    expect(x.plan.planOf('prog-a').epics.flatMap((e) => e.tickets.map((t) => [e.key, t.runId !== null])))
      .toEqual([['e1', false], ['e1', true], ['e2', true]]);
  });

  it('keeps waves-not-contiguous and wave-overlap among them', async () => {
    const x = await world();
    expect(refusal(await planVerb(x, 'prog-a', '', put(epic('gap', [1, 3]))))).toEqual([400, 'waves-not-contiguous']);
    expect(refusal(await planVerb(x, 'prog-a', '', put(epic('one', [1, 2]), epic('two', [2]))))).toEqual([409, 'wave-overlap']);
  });
});
