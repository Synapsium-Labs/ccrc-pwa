// D-6799: per-run token attribution, the server's half — the sweep's per-session
// block read (shares.ts), the run -> sessions join (coord/runSpend.ts).
import { describe, it, expect } from 'vitest';
import { parseSweepSessionSpend } from '../src/shares.js';
import { boundSessionsOf, joinRunSpend } from '../src/coord/runSpend.js';

const ISO = '2026-10-24T12:00:00Z';
const row = (input: number, output: number, cacheWrite: number, cacheRead: number, apiUsd: number) =>
  ({ n: 1, input, output, cacheWrite, cacheRead, apiUsd });
const sweep = (per: Record<string, unknown> | undefined): string =>
  JSON.stringify({ finishedAt: ISO, perAccount: {}, ...(per === undefined ? {} : { perCcdSession: per }) });

describe('parseSweepSessionSpend', () => {
  it('reads each registry session\'s tokens and proxy dollars, and the pass\'s finishedAt', () => {
    const r = parseSweepSessionSpend(sweep({ 'p-a': row(1, 2, 3, 4, 0.5) }));
    expect(r).toEqual({ kind: 'reading', measuredAt: ISO,
      bySession: { 'p-a': { tokens: { input: 1, cacheWrite: 3, cacheRead: 4, output: 2 }, proxyUsd: 0.5 } } });
  });
  it('a sweep written before the block existed is a reading with no sessions, not malformed', () => {
    expect(parseSweepSessionSpend(sweep(undefined))).toEqual({ kind: 'reading', measuredAt: ISO, bySession: {} });
  });
  it('malformed: not JSON, not an object, no parseable finishedAt, a perCcdSession that is not an object', () => {
    for (const c of ['nope', '[]', '{}', '{"finishedAt":"x"}', sweep([] as unknown as Record<string, unknown>)]) {
      expect(parseSweepSessionSpend(c), c).toEqual({ kind: 'malformed' });
    }
  });
  it('a session row with a non-numeric count is dropped, not zeroed (unmeasured is not free)', () => {
    const r = parseSweepSessionSpend(sweep({ bad: { ...row(1, 2, 3, 4, 0.5), output: 'x' }, ok: row(1, 1, 1, 1, 0) }));
    expect(r).toMatchObject({ kind: 'reading', bySession: { ok: expect.anything() } });
    expect((r as { bySession: object }).bySession).not.toHaveProperty('bad');
  });
});

describe('boundSessionsOf', () => {
  it('the current session plus every predecessor a session-rebound event names, once each, in order', () => {
    const ev = (detail: string | null) => ({ detail });
    expect(boundSessionsOf('s-3', [ev('session-rebound: s-1 -> s-2, 0 re-issued'), ev(null), ev('other'),
      ev('session-rebound: s-2 -> s-3, 2 re-issued')])).toEqual(['s-1', 's-2', 's-3']);
  });
  it('a session the workspace-spent path unbound still counts, beside the fresh one bound after it', () => {
    const ev = (detail: string | null) => ({ detail });
    expect(boundSessionsOf('demo-w2', [ev('session-unbound: demo-w1 (workspace-spent #42)')])).toEqual(['demo-w1', 'demo-w2']);
    // unbound and not yet re-bound: the run still has a past, so the server must not call it "no-session"
    expect(boundSessionsOf(null, [ev('session-unbound: demo-w1 (workspace-spent #42)')])).toEqual(['demo-w1']);
  });
  it('no session, no rebound: nothing; a lone session: itself', () => {
    expect(boundSessionsOf(null, [])).toEqual([]);
    expect(boundSessionsOf('s-1', [])).toEqual(['s-1']);
  });
});

describe('joinRunSpend', () => {
  const reading = parseSweepSessionSpend(sweep({ 'p-a': row(1, 2, 3, 4, 0.5), 'p-b': row(10, 20, 30, 40, 1.5) }));
  it('sums the tokens and dollars of every bound session the sweep saw', () => {
    expect(joinRunSpend(['p-a', 'p-b', 'p-gone'], reading)).toEqual({ measured: true, measuredAt: ISO, proxyUsd: 2,
      tokens: { input: 11, cacheWrite: 33, cacheRead: 44, output: 22 } });
  });
  it('unmeasured, with the reason, when nothing can be added up', () => {
    expect(joinRunSpend([], reading)).toEqual({ measured: false, reason: 'no-session' });
    expect(joinRunSpend(['p-gone'], reading)).toEqual({ measured: false, reason: 'not-swept' });
    expect(joinRunSpend(['p-a'], { kind: 'absent' })).toEqual({ measured: false, reason: 'no-sweep' });
    expect(joinRunSpend(['p-a'], { kind: 'unreadable' })).toEqual({ measured: false, reason: 'unreadable' });
    expect(joinRunSpend(['p-a'], { kind: 'malformed' })).toEqual({ measured: false, reason: 'malformed' });
  });
});
