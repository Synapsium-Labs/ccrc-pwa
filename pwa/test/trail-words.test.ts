// A run's trail in words (the runs rebuild, Task 7a, D-8072; spec 2026-11-04 §8.4, F16).
import { describe, expect, it } from 'vitest';
import type { RunRecordEvent } from '../../shared/api';
import { olderEventsLine, trailBy, trailLine } from '../src/fleet/trailWords';

const D = 86_400_000;
const T = Date.UTC(2026, 10, 2, 12, 0);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmt = (ms: number): string => { const d = new Date(ms); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} at 12:00`; };
const stallSpan = (count: number, days: number): RunRecordEvent => ({
  at: T, from: 'working', to: 'working', by: 'sweep', detail: null, folded: { count, untilAt: T + days * D },
});

describe('the trail', () => {
  it('names who in the words of the page', () => {
    expect(trailBy('operator')).toBe('you');
    expect(trailBy('sweep')).toBe('ccrc');
    expect(trailBy('coordinator')).toBe('the coordinator');
    expect(trailBy('session')).toBe('a session');
  });

  it('folds a span of stall checks into one line', () => {
    expect(trailLine(stallSpan(6, 2), fmt)).toBe('6 stall checks, 2 to 4 Nov');
    expect(trailLine(stallSpan(3, 0), fmt)).toBe('3 stall checks, 2 Nov');
    expect(trailLine(stallSpan(9, 30), fmt)).toBe('9 stall checks, 2 Nov to 2 Dec');
  });

  it('words a move and shows the stored detail as stored', () => {
    const e: RunRecordEvent = { at: T, from: 'awaiting-review', to: 'done', by: 'operator', detail: 'abandon:overtaken' };
    expect(trailLine(e, fmt)).toBe('awaiting review to done: abandon:overtaken');
    expect(trailLine({ ...e, from: 'planned', to: 'dispatched', detail: null }, fmt)).toBe('planned to dispatched');
  });

  it('says how many older events are not shown, or nothing', () => {
    expect(olderEventsLine(0)).toBeNull();
    expect(olderEventsLine(12)).toBe('12 older events not shown.');
  });
});
