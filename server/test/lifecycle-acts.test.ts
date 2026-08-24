// The journal's two closed vocabularies, pinned the `prphase.test.ts` way:
// the list under test is derived HERE from the UNION (`Record<LifecycleAct,
// true>`), not from the runtime constant it is checking, so two independent
// failures come out of one honest source — add a member to the union and this
// literal stops compiling (`typecheck-tests.test.ts` compiles this directory),
// and if `LIFECYCLE_ACT_MAP` in L0 was not updated with it, `isLifecycleAct`
// answers false for the new key and the first describe below goes red.
import { describe, it, expect } from 'vitest';
import {
  LIFECYCLE_ACTS, LC_ACT_UNKNOWN, isLifecycleAct,
  LIFECYCLE_OUTCOMES, LC_OUTCOME_UNKNOWN, isLifecycleOutcome,
  type LifecycleAct, type LifecycleOutcome,
} from '../../shared/api.js';

const ALL_ACTS: Record<LifecycleAct, true> = {
  create: true, claim: true, purge: true, supervise: true, unsupervise: true,
  destroy: true, rename: true, hold: true, release: true, archive: true, restore: true,
  'attic-drop': true, reap: true, gc: true, spawn: true, start: true, ensure: true,
  swap: true, enable: true, stop: true, forget: true,
  unknown: true,
};
const ACTS = Object.keys(ALL_ACTS) as LifecycleAct[];

const ALL_OUTCOMES: Record<LifecycleOutcome, true> = {
  intent: true, done: true, refused: true, failed: true, unknown: true,
};
const OUTCOMES = Object.keys(ALL_OUTCOMES) as LifecycleOutcome[];

describe('isLifecycleAct accepts exactly the declared acts', () => {
  it.each(ACTS)('%s', (act) => { expect(isLifecycleAct(act)).toBe(true); });

  it('covers the whole union — the runtime list cannot fall behind the type', () => {
    expect(ACTS.length).toBe(22);
    expect([...LIFECYCLE_ACTS].sort()).toEqual([...ACTS].sort());
  });

  it('is the ONLY door — the constant is cast, never the input', () => {
    // `PrReason`'s rule, and the reason it is a rule: an input asserted to be
    // an act is the very thing the check is asking about.
    for (const v of ['destroyed', 'ws-rm', '', 'CREATE', 0, null, undefined, {}, ['create']]) {
      expect(isLifecycleAct(v), String(v)).toBe(false);
    }
  });
});

describe('`unknown` is the READER-side degrade, never a ccd call site', () => {
  it('is a declared member, and LC_ACT_UNKNOWN names it once', () => {
    // Every filter in this repo that excludes the degrade must filter by this
    // constant, not by a literal that can be edited to match a mistake — the
    // shape `SESSION_LIFECYCLES.filter((s) => s !== 'unmeasurable')` already
    // wants and does not have.
    expect(LC_ACT_UNKNOWN).toBe('unknown');
    expect(LIFECYCLE_ACTS).toContain(LC_ACT_UNKNOWN);
    expect(LIFECYCLE_ACTS.filter((a) => a !== LC_ACT_UNKNOWN)).toHaveLength(21);
  });
});

describe('isLifecycleOutcome accepts exactly the declared outcomes', () => {
  it.each(OUTCOMES)('%s', (o) => { expect(isLifecycleOutcome(o)).toBe(true); });

  it('covers the whole union', () => {
    expect(OUTCOMES.length).toBe(5);
    expect([...LIFECYCLE_OUTCOMES].sort()).toEqual([...OUTCOMES].sort());
  });

  it('LC_OUTCOME_UNKNOWN names the outcome degrade once, exactly as the act side does', () => {
    // Both halves of the vocabulary have a degrade, so both halves name it by
    // a constant. Without this the mirror's `outcome: … : 'unknown'` and ccd's
    // `_LC_OUTCOMES` filter would each spell it inline, which is the second
    // home this file exists to prevent.
    expect(LC_OUTCOME_UNKNOWN).toBe('unknown');
    expect(LIFECYCLE_OUTCOMES).toContain(LC_OUTCOME_UNKNOWN);
    expect(LIFECYCLE_OUTCOMES.filter((o) => o !== LC_OUTCOME_UNKNOWN)).toHaveLength(4);
  });

  it('has NO `orphaned` member — an unpaired intent is DERIVED, never stored (D4)', () => {
    // "An `intent` with no sibling at all is a process that died mid-destroy"
    // is a fact about a PAIR of rows. Storing it as a third outcome would
    // require the writer to know the future, and would give the reader two
    // sources for one fact.
    expect(isLifecycleOutcome('orphaned')).toBe(false);
    expect(isLifecycleOutcome('interrupted')).toBe(false);
  });

  it('rejects everything else', () => {
    for (const v of ['refused-destruction', 'ok', '', 1, null, undefined, {}]) {
      expect(isLifecycleOutcome(v), String(v)).toBe(false);
    }
  });
});
