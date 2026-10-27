// D-7058 (ARCH-73 #808, its journal half; W8 Task C8f): the journal kernel's three pure pieces, held on their own.
// `maxJournalEpoch` is the two byte-twin `maxEpoch` bodies' shared regex walk (the I/O stays in each adapter);
// `journalFloor` is MAX(file, db) with `null` meaning "nothing recorded"; `appendThenApply` is the log-first order the
// writers keep inside their own `tx()`: decide, then append, then apply, the original error rethrown and the phase it
// reached left readable. The callers' own rows are `journal-log-first.test.ts` and `collect-lane-store.test.ts`.
import { describe, it, expect } from 'vitest';
import { appendThenApply, journalFloor, maxJournalEpoch, type JournalPhase } from '../src/journalKernel.js';

const NO_EPOCH = (journal: string, p: string): string =>
  `${journal} exists at ${p} but yields no epoch — zero-length or unparseable is not the same as absent; ` +
  'answering null here would be the reissue this file exists to prevent';

describe('maxJournalEpoch', () => {
  it('empty text throws the caller\'s sentence, byte for byte', () => {
    expect(() => maxJournalEpoch('', 'pool-edges journal', '/x/pool-edges.log')).toThrow(NO_EPOCH('pool-edges journal', '/x/pool-edges.log'));
    let msg = '';
    try { maxJournalEpoch('', 'update-intent journal', '/y/u.log'); } catch (e) { msg = (e as Error).message; }
    expect(msg).toBe(NO_EPOCH('update-intent journal', '/y/u.log'));
  });

  it('a file that yields no epoch throws (blank lines and other keys are not epochs)', () => {
    expect(() => maxJournalEpoch('\n\n{"n":4}\n', 'pool-edges journal', '/p')).toThrow(NO_EPOCH('pool-edges journal', '/p'));
  });

  it('answers the largest epoch over every line, and a torn tail counts', () => {
    expect(maxJournalEpoch('{"epoch":3}\n{"epoch":7', 'pool-edges journal', '/p')).toBe(7);
    expect(maxJournalEpoch('{"epoch":9}\n{"epoch":2}\n', 'pool-edges journal', '/p')).toBe(9);
    expect(maxJournalEpoch('garbage\n{"epoch":4,"at":1}\n\n', 'pool-edges journal', '/p')).toBe(4);
  });
});

describe('journalFloor', () => {
  it('is MAX with null meaning nothing recorded', () => {
    expect(journalFloor(null, null)).toBeNull();
    expect(journalFloor(4, null)).toBe(4);
    expect(journalFloor(null, 4)).toBe(4);
    expect(journalFloor(4, 9)).toBe(9);
    expect(journalFloor(9, 4)).toBe(9);
    expect(journalFloor(0, null)).toBe(0);
  });
});

describe('appendThenApply', () => {
  const recorded = (o: { stop?: boolean; appendFail?: Error; applyFail?: Error; decideFail?: Error } = {}) => {
    const calls: string[] = [];
    const step = {
      decide: (): { go: number } | { stop: string } => {
        calls.push('decide');
        if (o.decideFail !== undefined) throw o.decideFail;
        return o.stop === true ? { stop: 'refused' } : { go: 5 };
      },
      append: (d: number): void => { calls.push(`append:${d}`); if (o.appendFail !== undefined) throw o.appendFail; },
      apply: (d: number): string => { calls.push(`apply:${d}`); if (o.applyFail !== undefined) throw o.applyFail; return `applied:${d}`; },
    };
    return { calls, step };
  };

  it('appends before it applies, and answers what apply answers, phase done', () => {
    const { calls, step } = recorded();
    const phase: { at: JournalPhase } = { at: 'decide' };
    expect(appendThenApply(step, phase)).toBe('applied:5');
    expect(calls).toEqual(['decide', 'append:5', 'apply:5']);
    expect(phase.at).toBe('done');
  });

  it('a stop calls neither append nor apply, and answers the stop', () => {
    const { calls, step } = recorded({ stop: true });
    const phase: { at: JournalPhase } = { at: 'decide' };
    expect(appendThenApply(step, phase)).toBe('refused');
    expect(calls).toEqual(['decide']);
    expect(phase.at).toBe('decide');
  });

  it('never applies after an append that threw; the original error rethrown; phase left at append', () => {
    const err = new Error('append refused');
    const { calls, step } = recorded({ appendFail: err });
    const phase: { at: JournalPhase } = { at: 'decide' };
    let thrown: unknown = null;
    try { appendThenApply(step, phase); } catch (e) { thrown = e; }
    expect(thrown).toBe(err);
    expect(calls).toEqual(['decide', 'append:5']);
    expect(phase.at).toBe('append');
  });

  it('an apply that throws is rethrown unchanged, phase left at apply', () => {
    const err = Object.assign(new Error('row refused'), { code: 'ERR_SQLITE_ERROR' });
    const { step } = recorded({ applyFail: err });
    const phase: { at: JournalPhase } = { at: 'decide' };
    let thrown: unknown = null;
    try { appendThenApply(step, phase); } catch (e) { thrown = e; }
    expect(thrown).toBe(err);
    expect(phase.at).toBe('apply');
  });

  it('a decide that throws is rethrown unchanged, before any append', () => {
    const err = new Error('defect');
    const { calls, step } = recorded({ decideFail: err });
    const phase: { at: JournalPhase } = { at: 'decide' };
    expect(() => appendThenApply(step, phase)).toThrow(err);
    expect(calls).toEqual(['decide']);
    expect(phase.at).toBe('decide');
  });

  it('works without a phase', () => {
    const { calls, step } = recorded();
    expect(appendThenApply(step)).toBe('applied:5');
    expect(calls).toEqual(['decide', 'append:5', 'apply:5']);
  });
});
