// Overlord W1, the renewal readings' wiring (plan `w1-renewal-readings.md`, PRs A and C): `renewalReadingsOf` reads each wired
// producer once per pass, answers only the Overlord's fields, and catches each producer on its own (review 2183 F17); PR C adds
// the designation's two readings and binds the pass's latch raise to the ladder's one raise path.
import { describe, it, expect } from 'vitest';
import { FIT_WINDOW, SPOT_PROBE_EVERY_TOKENS } from '../../shared/continuity.js';
import type { BackstopRead } from '../../shared/renewal-readings.js';
import type { DesignationRead, DesignationView } from '../../shared/overlord-designation.js';
import type { LatchRaiseInput } from '../src/coord/overlordLadderStore.js';
import type { GenRow } from '../src/continuity/continuityStore.js';
import type { GenReadings } from '../src/continuity/generationsLane.js';
import { renewalReadingsOf, type ReadingsCoord } from '../src/continuity/renewalReadingsWiring.js';
import type { SpotsRead } from '../src/continuity/renewalReadings.js';
import type { UsageRead } from '../src/usage.js';

const NOW = Date.UTC(2026, 5, 10, 12, 0, 0);
const gen = (over: Partial<GenRow>): GenRow =>
  ({ id: 1, sessionId: 'lane-a-project-a', role: 'overlord', model: 'claude-opus-5-5', startReportedAt: NOW - 86_400_000, ...over }) as GenRow;
const usage = (ctxWindow: number | null, stale = false): UsageRead => ({ kind: 'reading', uuid: null, usage: {
  ts: 1, model: 'claude-opus-5-5', class: null, effort: null, ctxPct: null, ctxTokens: 1_000, ctxWindow, cost: null, cacheExpiresAt: null, stale,
} });
const base = (u: UsageRead = usage(200_000)): GenReadings =>
  ({ usage: u, compactions: { kind: 'absent' }, turn: { ok: false, reason: 'absent' } as never, behind: { kind: 'measured', value: false } });
const ROW: BackstopRead = { ok: true, backstop: { hour: 4, zone: 'UTC', isDefault: true, setAt: 0 } };
const NONE: DesignationRead = { kind: 'not-designated', row: null };
const VIEW = (over: Partial<DesignationView> = {}): DesignationView => ({
  bound: { sessionId: 'lane-a-project-a', generation: 'g1' }, pending: null, term: 1, designatedTerm: 1, model: 'fable',
  accountPools: { pools: ['pool-a'], untagged: false }, pastIds: [], actor: 'device:console-a', lastAttempt: null, stopsOwed: [], ...over,
});
const BOUND = (over: Partial<DesignationView> = {}): DesignationRead => ({ kind: 'designated', sessionId: 'lane-a-project-a', term: VIEW(over).term, row: VIEW(over) });
const FALSE = { kind: 'measured', value: false } as const;

function coordOf(over: Partial<{ spots: (cls: string) => SpotsRead; backstop: () => BackstopRead; designation: () => DesignationRead;
  raise: (latch: LatchRaiseInput) => ReturnType<ReadingsCoord['raiseLatch']> }> = {}) {
  const calls: string[] = [];
  const raised: LatchRaiseInput[] = [];
  const coord: ReadingsCoord = {
    closedSpotProbes: (cls) => { calls.push(`spots:${cls}`); return (over.spots ?? (() => ({ ok: true, spots: [] })))(cls) as never; },
    backstopRead: () => { calls.push('backstop'); return (over.backstop ?? (() => ROW))(); },
    designationRead: () => { calls.push('designation'); return (over.designation ?? (() => NONE))(); },
    raiseLatch: (_journal, latch) => { raised.push(latch); return (over.raise ?? (() => ({ ok: true, changed: true, journalled: true, recordSequence: 7, notice: 'none' as const })))(latch); },
  };
  return { coord, calls, raised };
}
const deps = (logs: string[] = []) => ({ time: { clock: { wall: () => NOW }, entropy: { hex: (n: number) => 'a'.repeat(2 * n) } }, log: (l: string) => logs.push(l) });

describe('renewalReadingsOf (PR A: the fitted ceiling and the backstop)', () => {
  it('an Overlord generation reads its fitted ceiling (the hard cap until fitted) and the backstop', async () => {
    const { coord } = coordOf();
    const r = await renewalReadingsOf(deps(), coord, []).w1(gen({}), base());
    expect(r.w1).toEqual({ fittedCeilingTokens: { kind: 'measured', value: 100_000 }, backstopDue: { kind: 'measured', value: true },
      termRaised: FALSE, classChanged: FALSE });
  });

  it('a coordinator generation gets none of the fields, and nothing is read for it', async () => {
    const { coord, calls } = coordOf();
    const r = await renewalReadingsOf(deps(), coord, []).w1(gen({ role: 'coordinator' }), base());
    expect(r.w1).toEqual({});
    expect(calls).toEqual([]);
  });

  it('the spots are read once per model class per pass, and the backstop row once per pass', async () => {
    const { coord, calls } = coordOf();
    const pass = renewalReadingsOf(deps(), coord, []);
    await pass.w1(gen({ id: 1 }), base());
    await pass.w1(gen({ id: 2 }), base());
    await pass.w1(gen({ id: 3, model: 'claude-sonnet-5-5' }), base());
    expect(calls.filter((c) => c.startsWith('spots:'))).toEqual(['spots:opus', 'spots:sonnet']);
    expect(calls.filter((c) => c === 'backstop')).toEqual(['backstop']);
    const next = renewalReadingsOf(deps(), coord, []);
    await next.w1(gen({}), base());
    expect(calls.filter((c) => c === 'backstop')).toHaveLength(2);
  });

  it('the window comes from the base readings of the same sample: a stale sidecar reads unmeasured', async () => {
    const { coord } = coordOf();
    const r = await renewalReadingsOf(deps(), coord, []).w1(gen({}), base(usage(200_000, true)));
    expect(r.w1?.fittedCeilingTokens).toEqual({ kind: 'unmeasured', why: 'usage stale' });
  });

  it('a model that is unknown reads unmeasured, and the spots are not read', async () => {
    const { coord, calls } = coordOf();
    const r = await renewalReadingsOf(deps(), coord, []).w1(gen({ model: null }), base());
    expect(r.w1?.fittedCeilingTokens).toEqual({ kind: 'unmeasured', why: 'model unknown' });
    expect(calls.some((c) => c.startsWith('spots:'))).toBe(false);
  });

  it('the class\'s spots reach the ceiling: a bad first bucket reads `no depth holds`', async () => {
    const spots = Array.from({ length: FIT_WINDOW }, (_, i) =>
      ({ depthTokens: SPOT_PROBE_EVERY_TOKENS, grade: 'fail' as const, closed: true, modelClass: 'opus', at: i }));
    const { coord } = coordOf({ spots: () => ({ ok: true, spots }) });
    const r = await renewalReadingsOf(deps(), coord, []).w1(gen({}), base(usage(1_000_000)));
    expect(r.w1?.fittedCeilingTokens).toEqual({ kind: 'unmeasured', why: 'no depth holds' });
  });

  it('a spot read that throws makes the ceiling unmeasured `fitted ceiling read failed`, leaves the backstop as its port answers, logs once, and the pass completes for every generation (F17)', async () => {
    const logs: string[] = [];
    const { coord } = coordOf({ spots: () => { throw new Error('disk'); } });
    const pass = renewalReadingsOf(deps(logs), coord, []);
    const one = await pass.w1(gen({ id: 1 }), base());
    const two = await pass.w1(gen({ id: 2 }), base());
    for (const r of [one, two]) {
      expect(r.w1).toEqual({ fittedCeilingTokens: { kind: 'unmeasured', why: 'fitted ceiling read failed' }, backstopDue: { kind: 'measured', value: true },
        termRaised: FALSE, classChanged: FALSE });
    }
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain('disk');
  });

  it('a backstop read that throws makes only `backstopDue` unmeasured; an unread row reads unmeasured with its detail', async () => {
    const thrown = coordOf({ backstop: () => { throw new Error('locked'); } });
    const r = await renewalReadingsOf(deps(), thrown.coord, []).w1(gen({}), base());
    expect(r.w1).toEqual({ fittedCeilingTokens: { kind: 'measured', value: 100_000 }, backstopDue: { kind: 'unmeasured', why: 'backstop read failed' },
      termRaised: FALSE, classChanged: FALSE });
    const unread = coordOf({ backstop: () => ({ ok: false, detail: 'renewal_backstop_settings has no row' }) });
    const u = await renewalReadingsOf(deps(), unread.coord, []).w1(gen({}), base());
    expect(u.w1?.backstopDue).toEqual({ kind: 'unmeasured', why: 'backstop unread: renewal_backstop_settings has no row' });
  });

  it('the backstop reads the generation\'s own start: one started after today\'s 04:00 UTC is not due', async () => {
    const { coord } = coordOf();
    const r = await renewalReadingsOf(deps(), coord, []).w1(gen({ startReportedAt: Date.UTC(2026, 5, 10, 5) }), base());
    expect(r.w1?.backstopDue).toEqual({ kind: 'measured', value: false });
  });
});

describe('renewalReadingsOf (PR C: the designation\'s readings)', () => {
  it('the designation is read once per pass, for Overlord generations only', async () => {
    const { coord, calls } = coordOf({ designation: () => BOUND() });
    const pass = renewalReadingsOf(deps(), coord, []);
    await pass.w1(gen({ id: 1, term: 1, designatedClass: 'fable' }), base());
    await pass.w1(gen({ id: 2, term: 1, designatedClass: 'fable' }), base());
    await pass.w1(gen({ id: 3, role: 'coordinator' }), base());
    expect(calls.filter((c) => c === 'designation')).toEqual(['designation']);
  });

  it('a restore that raised the term makes termRaised due; a class changed after the mint makes classChanged due', async () => {
    const { coord } = coordOf({ designation: () => BOUND({ term: 2, model: 'opus' }) });
    const r = await renewalReadingsOf(deps(), coord, []).w1(gen({ term: 1, designatedClass: 'fable' }), base());
    expect(r.w1?.termRaised).toEqual({ kind: 'measured', value: true });
    expect(r.w1?.classChanged).toEqual({ kind: 'measured', value: true });
  });

  it('a generation minted before the class was recorded reads classChanged unmeasured, and termRaised still reads', async () => {
    const { coord } = coordOf({ designation: () => BOUND() });
    const r = await renewalReadingsOf(deps(), coord, []).w1(gen({ term: 1, designatedClass: null }), base());
    expect(r.w1?.classChanged).toEqual({ kind: 'unmeasured', why: 'minted before the class was recorded' });
    expect(r.w1?.termRaised).toEqual(FALSE);
  });

  it('an unmeasured designation reads both unmeasured; a throwing read reads both `designation read failed`, logged once per reading, the rest unaffected', async () => {
    const unread = coordOf({ designation: () => ({ kind: 'unmeasured', why: 'a term is not a count' }) });
    const u = await renewalReadingsOf(deps(), unread.coord, []).w1(gen({ term: 1, designatedClass: 'fable' }), base());
    expect([u.w1?.termRaised, u.w1?.classChanged]).toEqual([{ kind: 'unmeasured', why: 'designation unreadable' }, { kind: 'unmeasured', why: 'designation unreadable' }]);
    const logs: string[] = [];
    const thrown = coordOf({ designation: () => { throw new Error('locked'); } });
    const t = await renewalReadingsOf(deps(logs), thrown.coord, []).w1(gen({ term: 1, designatedClass: 'fable' }), base());
    expect(t.w1).toEqual({ fittedCeilingTokens: { kind: 'measured', value: 100_000 }, backstopDue: { kind: 'measured', value: true },
      termRaised: { kind: 'unmeasured', why: 'designation read failed' }, classChanged: { kind: 'unmeasured', why: 'designation read failed' } });
    expect(logs.filter((l) => l.includes('locked'))).toHaveLength(2);
  });
});

describe('renewalReadingsOf (PR C: the latch raise)', () => {
  it('binds the ladder\'s one raise: the cap is the cause row\'s (chat), raised by the renewal lane, at the pass clock', async () => {
    const { coord, raised } = coordOf();
    const r = renewalReadingsOf(deps(), coord, []).latch('probes-failed-twice', 'generation 4 degraded');
    expect(r).toEqual({ ok: true });
    expect(raised).toHaveLength(1);
    expect(raised[0]).toMatchObject({ cause: 'probes-failed-twice', cap: 'chat', detail: 'generation 4 degraded', at: NOW,
      raisedBy: { kind: 'lane', lane: 'renewal-lane' } });
    expect(raised[0]!.opKey).toMatch(/^latch-raise-a+$/);
  });

  it('a refused raise answers ok false with the refusal word, for the lane to log', () => {
    const journal = coordOf({ raise: () => ({ ok: false, error: 'journal-unreadable' }) as never });
    expect(renewalReadingsOf(deps(), journal.coord, []).latch('probes-failed-twice', 'd')).toEqual({ ok: false, why: 'journal-unreadable' });
    const actor = coordOf({ raise: () => ({ ok: false, reason: 'actor' }) as never });
    expect(renewalReadingsOf(deps(), actor.coord, []).latch('probes-failed-twice', 'd')).toEqual({ ok: false, why: 'actor' });
  });
});
