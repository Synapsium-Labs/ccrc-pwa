// Routing spec 2026-09-14 §5.5 — the two signal lines a worker's `wave-done`
// body opens with, parsed by ONE L0 function the store and the skill tests
// share. Three answers per line (a value, absent, unrecognised): a worker on an
// older skill that sends no line is never read as a typo, and a typo is never
// read as silence.
import { describe, it, expect } from 'vitest';
import {
  FAILURE_KINDS, SUITE_WORDS, WAVE_DONE_SUBJECT, parseWaveDoneSignals,
  type FailureKind, type SuiteWord, type WaveDoneSignals,
} from '../../shared/api.js';

/** Derived from the UNION, `worker-skill.test.ts`'s `ALL_PHASES` idiom: a
 *  fourth member forces a key here (the tests directory is typechecked). */
const ALL_SUITE: Record<SuiteWord, true> = { green: true, red: true, unrun: true };
const ALL_FAILURE: Record<FailureKind, true> = { shallow: true, ceiling: true, unclear: true };

const absent = { ok: false, why: 'absent' } as const;
const unrec = { ok: false, why: 'unrecognised' } as const;

describe('the wave-done signal vocabularies', () => {
  it('are closed at three words each, and the arrays are the type', () => {
    expect([...SUITE_WORDS].sort()).toEqual(Object.keys(ALL_SUITE).sort());
    expect([...FAILURE_KINDS].sort()).toEqual(Object.keys(ALL_FAILURE).sort());
    expect(WAVE_DONE_SUBJECT).toBe('wave-done');
  });
});

describe('parseWaveDoneSignals', () => {
  it.each([...SUITE_WORDS])('reads suite: %s on the first line', (w) => {
    expect(parseWaveDoneSignals(`suite: ${w}\n{"branchTip":"x"}`))
      .toEqual<WaveDoneSignals>({ suite: { ok: true, value: w }, failure: absent });
  });

  it.each([...FAILURE_KINDS])('reads failure: %s on the second line', (k) => {
    expect(parseWaveDoneSignals(`suite: red\nfailure: ${k}\nprose`))
      .toEqual<WaveDoneSignals>({ suite: { ok: true, value: 'red' }, failure: { ok: true, value: k } });
  });

  it('reads the two lines in either order', () => {
    expect(parseWaveDoneSignals('failure: ceiling\nsuite: red\n'))
      .toEqual({ suite: { ok: true, value: 'red' }, failure: { ok: true, value: 'ceiling' } });
  });

  it('a word outside the vocabulary is UNRECOGNISED, never absent and never a value', () => {
    expect(parseWaveDoneSignals('suite: passed\nfailure: flaky'))
      .toEqual({ suite: unrec, failure: unrec });
  });

  it('a body with no signal lines is absent on both — an older worker, not a typo', () => {
    expect(parseWaveDoneSignals('{"branchTip":"x"}')).toEqual({ suite: absent, failure: absent });
    expect(parseWaveDoneSignals('')).toEqual({ suite: absent, failure: absent });
  });

  it('the lines must be the FIRST lines: a signal after prose or JSON is not read', () => {
    expect(parseWaveDoneSignals('{"branchTip":"x"}\nsuite: green')).toEqual({ suite: absent, failure: absent });
    expect(parseWaveDoneSignals('suite: green\n\nfailure: ceiling'))
      .toEqual({ suite: { ok: true, value: 'green' }, failure: absent });
  });

  it('a third line is never a signal line, and the first of a repeated key wins', () => {
    expect(parseWaveDoneSignals('suite: green\nsuite: red\nfailure: ceiling'))
      .toEqual({ suite: { ok: true, value: 'green' }, failure: absent });
  });

  it('the grammar is exact: one space after the colon, nothing after the word', () => {
    expect(parseWaveDoneSignals('suite:green')).toEqual({ suite: absent, failure: absent });
    expect(parseWaveDoneSignals('suite: green (first run)')).toEqual({ suite: absent, failure: absent });
    expect(parseWaveDoneSignals('Suite: green')).toEqual({ suite: absent, failure: absent });
  });

  it('tolerates CRLF and trailing spaces, which a pasted body may carry', () => {
    expect(parseWaveDoneSignals('suite: unrun \r\nfailure: unclear\r\n'))
      .toEqual({ suite: { ok: true, value: 'unrun' }, failure: { ok: true, value: 'unclear' } });
  });
});
