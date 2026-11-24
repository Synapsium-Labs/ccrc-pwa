// The done-test vocabulary (Overlord W2 done tests A, Task A1; plan docs/superpowers/plans/2026-11-16-overlord-w2/
// w2-done-tests.md §4, Table 5.5a as this piece builds it). Each list is derived from its key map; each is held here
// against an independently spelled list, so a word added to or dropped from a map is red even where the subset rules
// still hold.
import { describe, it, expect, expectTypeOf } from 'vitest';
import {
  DONE_PREDICATES, DONE_TEST_BOUNDS, DONE_VERDICTS, MEASURED_PREDICATES, TARGET_ANSWER_WORDS,
  type DonePredicate, type DoneTarget, type DoneTest, type TargetAnswer, type TargetAnswerWord,
} from '../../shared/doneTests.js';

const EXPECTED_PREDICATES = ['run-closed', 'pr-merged', 'review-passed', 'goals-modified', 'operator-confirms'];
const EXPECTED_MEASURED = ['run-closed', 'pr-merged', 'goals-modified'];
const EXPECTED_ANSWERS = ['passed', 'ended', 'pending', 'unmeasured', 'unmeasurable'];
const EXPECTED_VERDICTS = ['close', 'close-unverified', 'hold', 'none'];

describe('the done-test vocabulary (Table 5.5a)', () => {
  it('names the five predicates, in Table 5.5a order', () => {
    expect([...DONE_PREDICATES]).toEqual(EXPECTED_PREDICATES);
  });

  it('measures three of them in W2: review-passed and operator-confirms are not measured (DT4, DT5)', () => {
    expect([...MEASURED_PREDICATES]).toEqual(EXPECTED_MEASURED);
    for (const p of MEASURED_PREDICATES) expect(DONE_PREDICATES).toContain(p);
  });

  it('answers five words, two of them kinds of unmeasured (DT3)', () => {
    expect([...TARGET_ANSWER_WORDS]).toEqual(EXPECTED_ANSWERS);
  });

  it('decides four verdicts', () => {
    expect([...DONE_VERDICTS]).toEqual(EXPECTED_VERDICTS);
  });

  it('bounds a test at five entries', () => {
    expect(DONE_TEST_BOUNDS.entries).toBe(5);
  });

  it('every bare target names a predicate, and goals-modified has no bare form (DT2)', () => {
    expectTypeOf<DoneTarget['predicate']>().toMatchTypeOf<DonePredicate>();
    expectTypeOf<DoneTarget['predicate']>().toEqualTypeOf<'run-closed' | 'pr-merged' | 'review-passed' | 'operator-confirms'>();
    expectTypeOf<Extract<DoneTarget, { predicate: 'goals-modified' }>>().toBeNever();
    expectTypeOf<DoneTest[number]>().toEqualTypeOf<{ readonly predicate: DonePredicate }>();
    expectTypeOf<TargetAnswer['kind']>().toEqualTypeOf<TargetAnswerWord>();
  });
});
