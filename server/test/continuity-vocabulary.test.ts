// The generation vocabulary and Table 11.5b's starting values (Overlord W1a, renewal deciders Task 1). Each list's
// members in order, one guard per union, and every figure written out here against the spec row it comes from.
import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_LOAD_HARD, BREAK_NO_MESSAGE_MS, BREAK_PLACE_HIDDEN_MS, CHECKPOINT_THREAD, EARLY_WHILE_AWAY_FRACTION,
  GENERATION_OUTCOMES, GENERATION_STATES, HARD_CAP_TOKENS, HOLD_OFF_MS, IDLE_SOFT_MS, LEAST_AGE_MS, NOTES_CAP,
  RENEWAL_BUDGET_S, RENEWAL_TRIGGERS, SOFT_BUDGET, SOFT_CEILING_FRACTION, STATE_DEADLINE_S, TRIGGER_CLASSES, TURNS_SOFT,
  isGenerationOutcome, isGenerationState, isRenewalTrigger, isTriggerClass, IDLE_FLOOR_FRACTION, WAVE_BOUNDARY_FLOOR_FRACTION,
  RESUMED_LONG_FRACTION, ON_SCHEDULE_WAIT_MS, RENEWAL_LANE_PERIOD_MS, OBSERVED_STEP_PERIODS, CARDED_NUDGE_AT_MS,
} from '../../shared/continuity.js';

describe('the lists, each derived from one map, in order', () => {
  it('GENERATION_STATES: Table 3.3.11a', () => {
    expect(GENERATION_STATES).toEqual(['active', 'draining', 'checkpointed', 'clearing', 'carded', 'probing', 'degraded', 'ended']);
  });
  it('GENERATION_OUTCOMES: H12 (renewed, crashed, swapped, woken elsewhere) and woken on the same host', () => {
    expect(GENERATION_OUTCOMES).toEqual(['renewed', 'crashed', 'swapped', 'woken', 'woken-elsewhere']);
  });
  it('TRIGGER_CLASSES: Table 3.3.11b', () => { expect(TRIGGER_CLASSES).toEqual(['hard', 'soft']); });
  it('RENEWAL_TRIGGERS: Table 3.3.11b, and the operator\'s Renew now', () => {
    expect(RENEWAL_TRIGGERS).toEqual(['hard-cap', 'soft-ceiling', 'turns', 'two-compactions', 'idle', 'daily-backstop',
      'new-install', 'probe-failed', 'model-drift', 'resumed-other-class', 'entry-retired', 'term-raised',
      'account-outside-set', 'class-unservable', 'account-load', 'compaction-refused', 'class-changed', 'evaluation-due',
      'not-local', 'resumed-long', 'wave-boundary', 'operator']);
  });
});

describe('one guard per union: each accepts its members and refuses the rest', () => {
  const REFUSED: unknown[] = ['', 'constructor', 'toString', '__proto__', null, undefined, 0, {}, ['active']];
  it.each<[string, (v: unknown) => boolean, readonly string[], string]>([
    ['isGenerationState', isGenerationState, GENERATION_STATES, 'Active'],
    ['isGenerationOutcome', isGenerationOutcome, GENERATION_OUTCOMES, 'woken_elsewhere'],
    ['isTriggerClass', isTriggerClass, TRIGGER_CLASSES, 'hard '],
    ['isRenewalTrigger', isRenewalTrigger, RENEWAL_TRIGGERS, 'hardcap'],
  ])('%s', (_name, guard, members, nearMiss) => {
    for (const m of members) expect(guard(m), m).toBe(true);
    for (const v of [...REFUSED, nearMiss]) expect(guard(v), String(v)).toBe(false);
  });
});

describe('the starting values (Table 11.5b, Table 3.3.11a, Table 3.3.11b)', () => {
  it('Table 3.3.11a: each state\'s seconds', () => {
    expect(STATE_DEADLINE_S).toEqual({ draining: 120, checkpointed: 60, clearing: 90, carded: 45, probing: 165 });
  });
  it('§3.3.11 the budget of one renewal: checkpointed to active in 360 seconds', () => { expect(RENEWAL_BUDGET_S).toBe(360); });
  it('Table 11.5b "10 minutes | The hold-off after a renewal that went back to active"', () => { expect(HOLD_OFF_MS).toBe(600_000); });
  it('Table 11.5b "30 minutes | The least age of a generation"', () => { expect(LEAST_AGE_MS).toBe(1_800_000); });
  it('Table 11.5b "Three soft renewals in six hours"', () => { expect(SOFT_BUDGET).toEqual({ count: 3, windowMs: 21_600_000 }); });
  it('Table 11.5b "20 minutes with no operator message, or five minutes with no visible Overlord place"', () => {
    expect([BREAK_NO_MESSAGE_MS, BREAK_PLACE_HIDDEN_MS]).toEqual([1_200_000, 300_000]);
  });
  it('Table 11.5b "Half of a soft row\'s threshold"', () => { expect(EARLY_WHILE_AWAY_FRACTION).toBe(0.5); });
  it('Table 11.5b "up to 60 messages or 6,000 tokens" (the checkpoint\'s thread)', () => {
    expect(CHECKPOINT_THREAD).toEqual({ messages: 60, tokens: 6_000 });
  });
  it('Table 11.5b "200 notes of 500 characters"', () => { expect(NOTES_CAP).toEqual({ count: 200, chars: 500 }); });
  it('Table 3.3.11b hard cap "250k tokens", soft ceiling "60% of the fitted ceiling", turns "more than 40"', () => {
    expect([HARD_CAP_TOKENS, SOFT_CEILING_FRACTION, TURNS_SOFT]).toEqual([250_000, 0.6, 40]);
  });
  it('Table 3.3.11b idle "45 minutes", account load "past the harder line, 85%"', () => {
    expect([IDLE_SOFT_MS, ACCOUNT_LOAD_HARD]).toEqual([2_700_000, 0.85]);
  });
  it('Table 11.5b "A quarter of the hard cap" (idle floor); Table 3.3.11b wave boundary "a quarter", resumed long "half"', () => {
    expect([IDLE_FLOOR_FRACTION, WAVE_BOUNDARY_FLOOR_FRACTION, RESUMED_LONG_FRACTION]).toEqual([0.25, 0.25, 0.5]);
  });
  it('§3.3.11 R19 "Renew on schedule": a soft trigger waits at most 30 minutes', () => { expect(ON_SCHEDULE_WAIT_MS).toBe(1_800_000); });
  it('§11.5 one observed step is capped at twice the advancing lane\'s period (observed-time-caps-one-step)', () => {
    expect([RENEWAL_LANE_PERIOD_MS, OBSERVED_STEP_PERIODS]).toEqual([30_000, 2]);
  });
  it('Table 3.3.11a carded "45, with one re-nudge": the nudge point inside the 45 s (deadline-set-once-rounds-fit-inside)', () => {
    expect(CARDED_NUDGE_AT_MS).toBe(22_500);
  });
});
