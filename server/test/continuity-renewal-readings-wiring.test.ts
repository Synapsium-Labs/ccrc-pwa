// Overlord W1, the renewal readings' wiring (plan `w1-renewal-readings.md`, PR A): `renewalReadingsOf` reads each wired
// producer once per pass, answers only the Overlord's fields, and catches each producer on its own (review 2183 F17).
import { describe, it, expect } from 'vitest';
import { FIT_WINDOW, SPOT_PROBE_EVERY_TOKENS } from '../../shared/continuity.js';
import type { BackstopRead } from '../../shared/renewal-readings.js';
import type { GenRow } from '../src/continuity/continuityStore.js';
import type { GenReadings } from '../src/continuity/generationsLane.js';
import { renewalReadingsOf, type ReadingsCoord } from '../src/continuity/renewalReadingsWiring.js';
import type { SpotsRead } from '../src/continuity/renewalReadings.js';
import type { UsageRead } from '../src/usage.js';

const NOW = Date.UTC(2026, 5, 10, 12, 0, 0);
const gen = (over: Partial<GenRow>): GenRow =>
  ({ id: 1, sessionId: 'lane-a-project-a', role: 'overlord', model: 'claude-opus-5-5', startReportedAt: NOW - 86_400_000, ...over }) as GenRow;
const usage = (ctxWindow: number | null, stale = false): UsageRead => ({ kind: 'reading', usage: {
  ts: 1, model: 'claude-opus-5-5', class: null, effort: null, ctxPct: null, ctxTokens: 1_000, ctxWindow, cost: null, cacheExpiresAt: null, stale,
} });
const base = (u: UsageRead = usage(200_000)): GenReadings =>
  ({ usage: u, compactions: { kind: 'absent' }, turn: { ok: false, reason: 'absent' } as never, behind: { kind: 'measured', value: false } });
const ROW: BackstopRead = { ok: true, backstop: { hour: 4, zone: 'UTC', isDefault: true, setAt: 0 } };

function coordOf(over: Partial<{ spots: (cls: string) => SpotsRead; backstop: () => BackstopRead }> = {}) {
  const calls: string[] = [];
  const coord: ReadingsCoord = {
    closedSpotProbes: (cls) => { calls.push(`spots:${cls}`); return (over.spots ?? (() => ({ ok: true, spots: [] })))(cls) as never; },
    backstopRead: () => { calls.push('backstop'); return (over.backstop ?? (() => ROW))(); },
  };
  return { coord, calls };
}
const deps = (logs: string[] = []) => ({ time: { clock: { wall: () => NOW } }, log: (l: string) => logs.push(l) });

describe('renewalReadingsOf (PR A: the fitted ceiling and the backstop)', () => {
  it('an Overlord generation reads its fitted ceiling (the hard cap until fitted) and the backstop', async () => {
    const { coord } = coordOf();
    const r = await renewalReadingsOf(deps(), coord, []).w1(gen({}), base());
    expect(r.w1).toEqual({ fittedCeilingTokens: { kind: 'measured', value: 100_000 }, backstopDue: { kind: 'measured', value: true } });
  });

  it('a coordinator generation gets neither field, and nothing is read for it', async () => {
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
      expect(r.w1).toEqual({ fittedCeilingTokens: { kind: 'unmeasured', why: 'fitted ceiling read failed' }, backstopDue: { kind: 'measured', value: true } });
    }
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain('disk');
  });

  it('a backstop read that throws makes only `backstopDue` unmeasured; an unread row reads unmeasured with its detail', async () => {
    const thrown = coordOf({ backstop: () => { throw new Error('locked'); } });
    const r = await renewalReadingsOf(deps(), thrown.coord, []).w1(gen({}), base());
    expect(r.w1).toEqual({ fittedCeilingTokens: { kind: 'measured', value: 100_000 }, backstopDue: { kind: 'unmeasured', why: 'backstop read failed' } });
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
