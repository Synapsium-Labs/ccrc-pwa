import { describe, expect, it } from 'vitest';
import type { LifecycleDec, LifecycleObs } from '../../shared/api';
import { LC_ACT_UNKNOWN, LIFECYCLE_ACTS, LIFECYCLE_OUTCOMES } from '../../shared/api';
import {
  ACT_WORD, OUTCOME_GLYPH, OUTCOME_WORD, actWord, eventCorroboration, outcomeGlyph, outcomeWord,
} from '../src/session/journalWords';

const obsWith = (cg: LifecycleObs['cg']): LifecycleObs => ({
  cg, cgraw: '0::/app.slice/x.scope', pid: 100, ppid: 1, pane: null, paneWhy: null,
  tty: null, ssh: null,
});
const decWith = (surface: LifecycleDec['surface']): LifecycleDec => ({
  surface, actor: null, reason: null,
});

describe('journalWords: total over the L0 vocabulary', () => {
  it('has a non-empty word for every LifecycleAct — a new act cannot render a blank cell', () => {
    // The compile-time guard is Record<LifecycleAct, string> (TS2739 on a
    // missing key under `npm run build`); this is the RUNTIME twin, because
    // vitest transpiles without typechecking and a suite that only the
    // compiler can red is a suite the test runner cannot see fail.
    for (const act of LIFECYCLE_ACTS) {
      expect(ACT_WORD[act], `no word for act ${act}`).toBeTruthy();
    }
  });

  it('has a word AND a glyph for every LifecycleOutcome — no outcome read out of colour alone', () => {
    for (const o of LIFECYCLE_OUTCOMES) {
      expect(OUTCOME_WORD[o], `no word for outcome ${o}`).toBeTruthy();
      expect(OUTCOME_GLYPH[o], `no glyph for outcome ${o}`).toBeTruthy();
    }
  });

  it('renders the degrade with its preserved token, never a blank', () => {
    // D6: a byte we saw and could not model is a different fact from a byte
    // that was never there — so the token travels into the cell.
    expect(actWord(LC_ACT_UNKNOWN, 'frobnicate')).toContain('frobnicate');
    expect(actWord(LC_ACT_UNKNOWN, null)).toBe(ACT_WORD[LC_ACT_UNKNOWN]);
    // A token a NEWER server sends takes the same path as the reader's own
    // degrade — the raw string IS the preserved token then.
    expect(actWord('quarantine', null)).toContain('quarantine');
    expect(outcomeWord('some-future-outcome')).toBe(OUTCOME_WORD.unknown);
    expect(outcomeGlyph('some-future-outcome')).toBe(OUTCOME_GLYPH.unknown);
  });
});

describe('journalWords: the corroboration door', () => {
  it('relates obs and dec through the L0 ladder', () => {
    expect(eventCorroboration({ obs: obsWith('pane'), dec: decWith('cli') })).toBe('agrees');
    // The supervisor passes no flags, so any declaration from it disagrees.
    expect(eventCorroboration({ obs: obsWith('supervisor'), dec: decWith('pwa') })).toBe('disagrees');
  });

  it('degrades absence and unmodelled tokens to unmeasured, never to a disagreement', () => {
    expect(eventCorroboration({ obs: null, dec: decWith('cli') })).toBe('unmeasured');
    expect(eventCorroboration({ obs: obsWith('pane'), dec: null })).toBe('unmeasured');
    // corroboration()'s own contract: args are NARROWED, never cast — a
    // value that passes neither guard is dropped, not reported as a lie.
    expect(eventCorroboration({ obs: obsWith('fifth-shape' as never), dec: decWith('cli') }))
      .toBe('unmeasured');
  });
});
