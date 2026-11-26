// The load lines over the Overlord's accounts and the two load readings (Overlord W1 serviceability PR B, plan
// `docs/superpowers/plans/2026-11-14-overlord-w1/w1-serviceability.md` Task 4, questions 13 and 14, F1, F16).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LOAD_FRESH_S, LOAD_LINE_PCT } from '../../shared/loadLines.js';
import type { DesignationRead, DesignationView, OverlordModelClass } from '../../shared/overlord-designation.js';
import type { LaneFacts } from '../../shared/serviceability.js';
import {
  accountLoadMoveReading, classUnservableReading, loadLines, overlordLoadCandidates, type Candidate, type LoadFacts,
} from '../src/accountLoad.js';
import type { AccountLimits } from '../src/limits.js';
import { REPO } from './rings/walkSrc.js';

const NOW = 2_000_000_000;
const lim = (five: number | null, seven: number | null, ago = 60, over: Partial<AccountLimits> = {}): AccountLimits => ({
  five, seven, ts: NOW - ago, fiveResetAt: NOW + 9_000, sevenResetAt: NOW + 300_000, fiveRolledOver: false, sevenRolledOver: false,
  disabled: false, authDead: false, ...over,
});
const lane = (seven: number | null, over: Partial<LaneFacts> = {}): LaneFacts => ({
  anthropic: true, seven, share: { estimatePct: 10, finishedAtS: NOW - 60 }, fableBilling: 'included', continuity: 'recorded', ...over,
});
const cand = (id: string, limits: AccountLimits | undefined, serves: Candidate['serves'] = 'yes'): Candidate => ({ id, limits, serves });
const designated = (model: OverlordModelClass): DesignationRead =>
  ({ kind: 'designated', sessionId: 'overlord-a', term: 1, row: { model } as unknown as DesignationView });

describe('overlordLoadCandidates (F1)', () => {
  const facts = (lanes: Record<string, LaneFacts>, limits: Record<string, AccountLimits>): LoadFacts => ({ lanes, limits, nowS: NOW });
  it('nobody designated is not-designated; an unreadable designation is unmeasured, never not-designated', () => {
    expect(overlordLoadCandidates({ kind: 'not-designated', row: null }, ['lane-a'], facts({}, {}))).toEqual({ kind: 'not-designated' });
    expect(overlordLoadCandidates({ kind: 'unmeasured', why: 'x' }, ['lane-a'], facts({}, {})))
      .toEqual({ kind: 'unmeasured', why: 'designation-unreadable' });
  });
  it('serves yes on either class; an account at the ceiling stays at-ceiling with its figure', () => {
    const l = { a: lim(50, 50), b: lim(99, 99) };
    const got = overlordLoadCandidates(designated('opus'), ['a', 'b'], facts({ a: lane(50), b: lane(99) }, l));
    expect(got).toEqual({ kind: 'candidates', list: [cand('a', l.a), cand('b', l.b, 'at-ceiling')] });
  });
  it('fable refused by its billing still serves on the fallback; fable at its share ceiling is no load refusal', () => {
    const l = { a: lim(50, 50), b: lim(99, 99) };
    const got = overlordLoadCandidates(designated('fable'), ['a', 'b'],
      facts({ a: lane(50, { fableBilling: 'credits' }), b: lane(99, { share: { estimatePct: 90, finishedAtS: NOW } }) }, l));
    expect(got).toEqual({ kind: 'candidates', list: [cand('a', l.a), cand('b', l.b, 'at-ceiling')] });
  });
  it('left out: signed out, and both answers refused by a non-load word', () => {
    const l = { a: lim(50, 50, 60, { authDead: true }), b: lim(50, 50), c: lim(50, 50) };
    const got = overlordLoadCandidates(designated('opus'), ['a', 'b', 'c'],
      facts({ a: lane(50), b: lane(50, { continuity: 'none' }), c: lane(50, { continuity: 'unread' }) }, l));
    expect(got).toEqual({ kind: 'candidates', list: [] });
  });
  it('a missing lane, or no figure, is a kept candidate, unmeasured', () => {
    const l = { a: lim(null, null), b: lim(50, 50) };
    const got = overlordLoadCandidates(designated('opus'), ['a', 'b'], facts({ a: lane(null) }, l));
    expect(got).toEqual({ kind: 'candidates', list: [cand('a', l.a, 'unmeasured'), cand('b', l.b, 'unmeasured')] });
  });
});

describe('loadLines (question 14, F1)', () => {
  it('no candidate is unmeasured no-candidate', () => {
    expect(loadLines([], NOW).chat).toEqual({ kind: 'unmeasured', why: 'no-candidate' });
  });
  it('one fresh account under and one stale account: under', () => {
    expect(loadLines([cand('a', lim(40, 40)), cand('b', lim(10, 10, LOAD_FRESH_S + 1))], NOW).chat).toEqual({ kind: 'under' });
  });
  it('a fresh reading proves under only for an account that serves', () => {
    expect(loadLines([cand('a', lim(40, 40), 'unmeasured'), cand('b', lim(96, 96))], NOW).chat).toEqual({ kind: 'unmeasured', why: 'stale' });
  });
  it('every account fresh and past: past with the least load', () => {
    expect(loadLines([cand('a', lim(96, 97)), cand('b', lim(99, 96))], NOW).chat).toEqual({ kind: 'past', leastPct: 97 });
  });
  it('one stale-under account and the rest past: unmeasured stale', () => {
    expect(loadLines([cand('a', lim(96, 96)), cand('b', lim(10, 10, LOAD_FRESH_S + 1))], NOW).chat).toEqual({ kind: 'unmeasured', why: 'stale' });
  });
  it('the line is reached at its value: 95 is past, 94.9 under', () => {
    expect(loadLines([cand('a', lim(95, 95))], NOW).chat).toEqual({ kind: 'past', leastPct: 95 });
    expect(loadLines([cand('a', lim(94.9, 94.9))], NOW).chat).toEqual({ kind: 'under' });
  });
  it('a fresh reading is within LOAD_FRESH_S, inclusive', () => {
    expect(loadLines([cand('a', lim(10, 10, LOAD_FRESH_S))], NOW).chat).toEqual({ kind: 'under' });
    expect(loadLines([cand('a', lim(10, 10, LOAD_FRESH_S + 1))], NOW).chat).toEqual({ kind: 'unmeasured', why: 'stale' });
  });
  it('a past reading stays past at any age; a rolled-over one proves nothing', () => {
    expect(loadLines([cand('a', lim(96, 96, LOAD_FRESH_S * 4))], NOW).chat).toEqual({ kind: 'past', leastPct: 96 });
    const rolled = lim(0, 0, 60, { fiveRolledOver: true, sevenRolledOver: true });
    expect(loadLines([cand('a', rolled)], NOW).chat).toEqual({ kind: 'unmeasured', why: 'stale' });
  });
  it('one known window proves past alone, never under', () => {
    expect(loadLines([cand('a', lim(null, 96))], NOW).chat).toEqual({ kind: 'past', leastPct: 96 });
    expect(loadLines([cand('a', lim(null, 40))], NOW).chat).toEqual({ kind: 'unmeasured', why: 'stale' });
  });
  it.each([96, 98, 99])('every candidate at %i percent, at the ceiling included, reads past: the cap cannot lift (F1)', (pct) => {
    const l = { a: lim(pct, pct), b: lim(pct, pct) };
    const got = overlordLoadCandidates(designated('opus'), ['a', 'b'], { lanes: { a: lane(pct), b: lane(pct) }, limits: l, nowS: NOW });
    expect(got.kind).toBe('candidates');
    const list = (got as Extract<typeof got, { kind: 'candidates' }>).list;
    expect(list.every((c) => c.serves === (pct >= 98 ? 'at-ceiling' : 'yes'))).toBe(true);
    expect(loadLines(list, NOW).chat).toEqual({ kind: 'past', leastPct: pct });
  });
  it('every account left out for non-load words: no-candidate', () => {
    const got = overlordLoadCandidates(designated('fable'), ['a'],
      { lanes: { a: lane(10, { continuity: 'none' }) }, limits: { a: lim(10, 10) }, nowS: NOW });
    expect(loadLines((got as Extract<typeof got, { kind: 'candidates' }>).list, NOW).chat).toEqual({ kind: 'unmeasured', why: 'no-candidate' });
  });
  it('soft and hard are read at their own values', () => {
    const lines = loadLines([cand('a', lim(80, 80))], NOW);
    expect(lines.soft).toEqual({ kind: 'past', leastPct: 80 });
    expect(lines.hard).toEqual({ kind: 'under' });
  });
});

describe('classUnservableReading', () => {
  it('unservable is true; servable and skipped false; unmeasured keeps its word', () => {
    expect(classUnservableReading({ kind: 'unservable', why: 'credits' })).toEqual({ kind: 'measured', value: true });
    expect(classUnservableReading({ kind: 'servable', figurePct: 1 })).toEqual({ kind: 'measured', value: false });
    expect(classUnservableReading({ kind: 'skipped' })).toEqual({ kind: 'measured', value: false });
    expect(classUnservableReading({ kind: 'unmeasured', why: 'stale' })).toEqual({ kind: 'unmeasured', why: 'stale' });
  });
});

describe('accountLoadMoveReading (C57, F16)', () => {
  const hot = cand('cur', lim(86, 86));
  it('true: the current account at or past hard and a counted other fresh under soft', () => {
    expect(accountLoadMoveReading(cand('cur', lim(85, 85)), [cand('o', lim(69, 69))], NOW)).toEqual({ kind: 'measured', value: true });
  });
  it('false: the current account fresh under hard', () => {
    expect(accountLoadMoveReading(cand('cur', lim(84.9, 84.9)), [cand('o', lim(10, 10))], NOW)).toEqual({ kind: 'measured', value: false });
  });
  it('false: every counted other at or past soft, or none counted', () => {
    expect(accountLoadMoveReading(hot, [cand('o', lim(70, 70))], NOW)).toEqual({ kind: 'measured', value: false });
    expect(accountLoadMoveReading(hot, [], NOW)).toEqual({ kind: 'measured', value: false });
  });
  it('an other that cannot serve is not counted: an under-soft account with no continuity record reads false (F16)', () => {
    expect(accountLoadMoveReading(hot, [cand('o', lim(10, 10), 'unmeasured')], NOW)).toEqual({ kind: 'measured', value: false });
  });
  it('a counted other nobody measured holds it unmeasured, never "no counted other"', () => {
    expect(accountLoadMoveReading(hot, [cand('o', lim(10, 10, LOAD_FRESH_S + 1))], NOW).kind).toBe('unmeasured');
    expect(accountLoadMoveReading(hot, [cand('o', lim(null, null))], NOW).kind).toBe('unmeasured');
  });
  it('a stale current account under hard decides nothing by itself', () => {
    expect(accountLoadMoveReading(cand('cur', lim(50, 50, LOAD_FRESH_S + 1)), [cand('o', lim(10, 10))], NOW).kind).toBe('unmeasured');
  });
});

describe('the pins', () => {
  it('LOAD_FRESH_S is longer than the keepalive\'s default window plus its timer, both harvested from the tree (N3)', () => {
    const keepalive = readFileSync(path.join(REPO, 'ccd', 'ccd-telemetry-keepalive'), 'utf8');
    const fresh = Number(/^_ccrc_knob CCRC_KEEPALIVE_FRESH (\d+) /m.exec(keepalive)?.[1]);
    const timer = readFileSync(path.join(REPO, 'deploy', 'systemd', 'ccd-telemetry-keepalive.timer'), 'utf8');
    const m = /OnUnitActiveSec=(\d+)(min|s)?/.exec(timer);
    const every = Number(m?.[1]) * (m?.[2] === 'min' ? 60 : 1);
    expect(fresh).toBeGreaterThan(0);
    expect(every).toBeGreaterThan(0);
    expect(LOAD_FRESH_S).toBeGreaterThan(fresh + every);
  });
  it('the soft line is ccd\'s FRESH_PICK_SOFT_PCT, harvested from ccd/lib/long-lived.sh', () => {
    const lib = readFileSync(path.join(REPO, 'ccd', 'lib', 'long-lived.sh'), 'utf8');
    expect(Number(/^FRESH_PICK_SOFT_PCT=(\d+)$/m.exec(lib)?.[1])).toBe(LOAD_LINE_PCT.soft);
  });
  it('the lines are 70, 85 and 95, rising', () => {
    expect(LOAD_LINE_PCT).toEqual({ soft: 70, hard: 85, chat: 95 });
  });
});
