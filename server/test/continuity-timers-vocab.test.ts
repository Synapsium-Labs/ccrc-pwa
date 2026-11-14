import { describe, expect, it } from 'vitest';
import {
  TERMINAL_TIMER_STATES, TIMER_ACTORS, TIMER_CANCEL_REASONS, TIMER_DUE_MAX_MS, TIMER_DUE_MIN_MS, TIMER_HOLD_CAP_MS,
  TIMER_KEEP_MS, TIMER_LANE_PERIOD_MS, TIMER_MAIL_SENDER, TIMER_NOTE_MAX_CHARS, TIMER_PREVIEW_CHARS, TIMER_SETS_PER_HOUR,
  TIMER_STATES, TIMER_TRANSITIONS, cancelActorOf, isTimerCancelReason, timerMoveAllowed, type TimerState,
} from '../../shared/continuity-timers.js';
import { REFUSAL_STATUS, ROUTE_REFUSALS, TIMER_REFUSALS } from '../../shared/refusal.js';

// The timers' vocabulary (Overlord W1a, the timers piece, Task 1; spec §3.3.12, C61 to C65, Table 11.5b).
describe('the timers vocabulary (C61, C65)', () => {
  it('names three states, two of them terminal', () => {
    expect(TIMER_STATES).toEqual(['pending', 'fired', 'cancelled']);
    expect([...TERMINAL_TIMER_STATES]).toEqual(['fired', 'cancelled']);
  });

  it('TIMER_TRANSITIONS is total: every non-terminal state has a move out, no terminal state has one', () => {
    const terminal = new Set<TimerState>(TERMINAL_TIMER_STATES);
    for (const s of TIMER_STATES) {
      const out = TIMER_TRANSITIONS.filter((t) => t.from === s);
      expect(out.length > 0, s).toBe(!terminal.has(s));
    }
    // The set is the only move from nothing, and lands on pending.
    expect(TIMER_TRANSITIONS.filter((t) => t.from === null)).toEqual([{ from: null, to: 'pending', actor: 'set-door' }]);
    // Every actor owns at least one move; every move names a known actor.
    for (const a of TIMER_ACTORS) expect(TIMER_TRANSITIONS.some((t) => t.actor === a), a).toBe(true);
    for (const t of TIMER_TRANSITIONS) expect(TIMER_ACTORS).toContain(t.actor);
  });

  it('timerMoveAllowed refuses every move out of a terminal state, pending to pending, and a move by the wrong actor', () => {
    for (const from of TERMINAL_TIMER_STATES) {
      for (const to of TIMER_STATES) for (const a of TIMER_ACTORS) expect(timerMoveAllowed(from, to, a), `${from}->${to} ${a}`).toBe(false);
    }
    for (const a of TIMER_ACTORS) expect(timerMoveAllowed('pending', 'pending', a), a).toBe(false);
    expect(timerMoveAllowed('pending', 'fired', 'cleanup')).toBe(false);
    expect(timerMoveAllowed('pending', 'fired', 'setter-cancel')).toBe(false);
    expect(timerMoveAllowed('pending', 'cancelled', 'timer-lane')).toBe(false);
    expect(timerMoveAllowed(null, 'pending', 'timer-lane')).toBe(false);
    expect(timerMoveAllowed(null, 'fired', 'timer-lane')).toBe(false);
    // CONTROL: the rows themselves are allowed.
    for (const t of TIMER_TRANSITIONS) expect(timerMoveAllowed(t.from, t.to, t.actor)).toBe(true);
  });

  it('every cancel reason names an actor that has a pending to cancelled move, and the pairing is the table', () => {
    for (const r of TIMER_CANCEL_REASONS) expect(timerMoveAllowed('pending', 'cancelled', cancelActorOf(r)), r).toBe(true);
    expect(Object.fromEntries(TIMER_CANCEL_REASONS.map((r) => [r, cancelActorOf(r)]))).toEqual({
      setter: 'setter-cancel', operator: 'operator-cancel', 'run-closed': 'cleanup', 'programme-ended': 'cleanup',
      'setter-archived': 'cleanup', 'setter-gone': 'cleanup', retired: 'cleanup',
    });
  });

  it('isTimerCancelReason accepts exactly the reasons', () => {
    for (const r of TIMER_CANCEL_REASONS) expect(isTimerCancelReason(r)).toBe(true);
    for (const v of ['', 'Setter', 'cleanup', 'expired', '__proto__', 'toString', 'hasOwnProperty']) expect(isTimerCancelReason(v), v).toBe(false);
  });

  it('the bounds are Table 11.5b\'s', () => {
    expect(TIMER_NOTE_MAX_CHARS).toBe(500);
    expect(TIMER_DUE_MIN_MS).toBe(5 * 60_000);
    expect(TIMER_DUE_MAX_MS).toBe(30 * 86_400_000);
    expect(TIMER_SETS_PER_HOUR).toBe(30);
    expect(TIMER_LANE_PERIOD_MS).toBe(60_000);
    expect(TIMER_KEEP_MS).toBe(90 * 86_400_000);
    expect(TIMER_HOLD_CAP_MS).toBe(24 * 3_600_000);
    expect(TIMER_PREVIEW_CHARS).toBe(60);
    expect(TIMER_MAIL_SENDER).toBe('timer');
  });

  it('every timer refusal word is a route refusal with its status (spec §11.6)', () => {
    const want: Record<string, number> = {
      'timer-cap': 409, 'timer-rate': 429, 'timer-too-soon': 400, 'timer-too-late': 400, 'timer-too-long': 400,
      'timer-masked': 400, 'timer-unmeasured': 503, 'timer-key-unknown': 403, 'timer-not-yours': 403, 'timer-not-pending': 409,
    };
    expect({ ...TIMER_REFUSALS }).toEqual(want);
    for (const [w, status] of Object.entries(want)) {
      expect(ROUTE_REFUSALS, w).toContain(w);
      expect((REFUSAL_STATUS as Readonly<Record<string, number>>)[w], w).toBe(status);
    }
    // `capability-missing` is the client's word only in W1a (Task 11): not a route refusal.
    expect(ROUTE_REFUSALS).not.toContain('capability-missing');
  });
});
