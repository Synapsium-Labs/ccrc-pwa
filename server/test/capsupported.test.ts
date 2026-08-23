// server/test/capsupported.test.ts
//
// `capSupported` is `stopSurfaceSupported`'s body with the token lifted to a
// parameter — and, critically, WITH ITS DEFAULT UNMOVED. The asymmetry is the
// whole point and `ccdargv.ts`'s own docstring argues it at length: for every
// gated VERB, guessing wrong on no evidence costs a loud failure, so
// `verbSupported` permits; for a FLAG it costs a silent success, so this
// refuses.
import { describe, it, expect } from 'vitest';
import {
  ACTOR_FLAGS_CAP, CCD_ARGV, capSupported, stopSurfaceSupported, verbSupported,
} from '../src/ccdargv.js';

const state = (ccdVerbs: string[] | null) => ({ ccdVerbs });

describe('capSupported', () => {
  it('answers true only when the deployed ccd advertised the token', () => {
    expect(capSupported(state(['ws-archive', ACTOR_FLAGS_CAP]), ACTOR_FLAGS_CAP)).toBe(true);
    expect(capSupported(state(['ws-archive']), ACTOR_FLAGS_CAP)).toBe(false);
  });

  it('REFUSES on no evidence — a null list and an absent state alike', () => {
    // THE MUTANT THIS EXISTS FOR: flip either branch to `true` and an old ccd
    // starts receiving `--surface pwa` it parses as argv it does not know.
    expect(capSupported(state(null), ACTOR_FLAGS_CAP)).toBe(false);
    expect(capSupported(undefined, ACTOR_FLAGS_CAP)).toBe(false);
    expect(capSupported(state([]), ACTOR_FLAGS_CAP)).toBe(false);
  });

  it('is the OPPOSITE of verbSupported on the same no-evidence input', () => {
    // Stated as an assertion rather than a comment, because the two functions
    // are one line apart and the next editor's instinct is to unify them.
    expect(verbSupported(state(null), CCD_ARGV.ensure('x'))).toBe(true);
    expect(capSupported(state(null), 'stop-surface')).toBe(false);
  });

  it('stopSurfaceSupported is capSupported bound to its own token', () => {
    for (const verbs of [null, [], ['stop'], ['stop', 'stop-surface']]) {
      expect(stopSurfaceSupported(state(verbs))).toBe(capSupported(state(verbs), 'stop-surface'));
    }
    expect(stopSurfaceSupported(undefined)).toBe(capSupported(undefined, 'stop-surface'));
  });

  it('spells the actor-flags token exactly once in server/src', () => {
    // The other two spellings are deliberate and elsewhere: ccd's own `echo`
    // and `ccd-archive.test.ts`'s KNOWN_CAPABILITY_TOKENS, which is the pin.
    expect(ACTOR_FLAGS_CAP).toBe('actor-flags-v1');
  });
});
