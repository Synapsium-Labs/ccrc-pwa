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
  deviceActor, type ActorFlags,
} from '../src/ccdargv.js';
import { isExecAllowed } from '../../agent/src/whitelist.js';
import type { DecSurface } from '../../shared/api.js';

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

const DEC: ActorFlags = { surface: 'pwa', actor: 'device:iPhone', reason: null };

describe('ActorFlags is the PRODUCER shape of L0`s LifecycleDec', () => {
  it('its surface is assignable to DecSurface, so the record can widen but not narrow', () => {
    // AUDIT M9. Two shapes, one triple, and the relationship written down as a
    // TYPE rather than as prose: `ActorFlags.surface` is `StopSurface` and
    // NEVER `'none'` (absence is `dec: null`, which omits the flags entirely);
    // `LifecycleDec.surface` is `DecSurface = StopSurface | 'none'`, the RECORD
    // shape, where `'none'` is what ccd writes when no flag arrived. `actor` is
    // mandatory here because `deviceActor`/`sweepDec` always measure one, and
    // nullable there because an older ccd may have written none.
    const surface: DecSurface = ({} as ActorFlags).surface;
    expect(typeof surface).toBe('undefined');   // a TYPE-level pin; the value is irrelevant
  });
});

describe('the dec flags ride AFTER the granted prefix, and need no new grant', () => {
  it('omits every flag for a null dec — the byte-identical pre-wave argv', () => {
    expect(CCD_ARGV.wsArchive('demo-quiet-basin', null))
      .toEqual(['ws-archive', '--session', 'demo-quiet-basin']);
    expect(CCD_ARGV.wsHold('demo-quiet-basin', 'program:x wave:1/4', null))
      .toEqual(['ws-hold', '--session', 'demo-quiet-basin', '--reason', 'program:x wave:1/4']);
  });

  it('appends the flags after the required ones, never before', () => {
    expect(CCD_ARGV.wsArchive('demo-quiet-basin', DEC))
      .toEqual(['ws-archive', '--session', 'demo-quiet-basin', '--surface', 'pwa', '--actor', 'device:iPhone']);
    expect(CCD_ARGV.wsRename('demo-quiet-basin', 'ws/x', { ...DEC, reason: 'ai title' }))
      .toEqual(['ws-rename', '--session', 'demo-quiet-basin', '--branch', 'ws/x',
                '--surface', 'pwa', '--actor', 'device:iPhone', '--reason', 'ai title']);
  });

  it('every flagged argv still passes the agent whitelist — ZERO new grants', () => {
    // `isExecAllowed` is PREFIX-matching, and every grant for these five verbs
    // is `['<verb>','--session']` (agent/src/whitelist.ts:335-367): flags after
    // the prefix are "tokens after the prefix are unconstrained". This is the
    // proof of the design's headline zero-grants property.
    for (const argv of [
      CCD_ARGV.wsArchive('demo-quiet-basin', DEC),
      CCD_ARGV.wsRestore('demo-quiet-basin', DEC),
      CCD_ARGV.wsHold('demo-quiet-basin', 'program:x wave:1/4', DEC),
      CCD_ARGV.wsRelease('demo-quiet-basin', DEC),
      CCD_ARGV.wsRename('demo-quiet-basin', 'ws/x', DEC),
    ]) {
      expect(isExecAllowed('ccd', [...argv]), `ccd ${argv.join(' ')}`).toBe(true);
    }
  });

  it('sends ONE --reason on ws-hold, and it is the hold`s own', () => {
    const argv = CCD_ARGV.wsHold('demo-quiet-basin', 'program:x wave:1/4', { ...DEC, reason: 'ignored' });
    expect(argv.filter((t) => t === '--reason')).toHaveLength(1);
    expect(argv).toEqual(['ws-hold', '--session', 'demo-quiet-basin', '--reason', 'program:x wave:1/4',
                          '--surface', 'pwa', '--actor', 'device:iPhone']);
  });

  it('omits --reason when it is null, rather than sending an empty one', () => {
    // ccd REFUSES `--reason ''` (a declaration that says nothing is not a
    // declaration, AUDIT B5). Sending one would be a 502 on every sweep.
    expect(CCD_ARGV.wsRelease('demo-quiet-basin', DEC)).not.toContain('--reason');
  });
});

describe('deviceActor', () => {
  it('names the device when the gate measured one', () => {
    expect(deviceActor('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)'))
      .toBe('device:Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)');
  });

  it('says `unmeasured`, never a fabricated device, when there is no session', () => {
    // A dark box (the shipped default) has no session layer, so every route
    // measures null. `unmeasured` and a UA-less browser's own `unknown device`
    // are two different facts and must not collapse — the "no overloaded null
    // at a seam" rule, at the seam that carries provenance.
    expect(deviceActor(null)).toBe('device:unmeasured');
    expect(deviceActor('unknown device')).toBe('device:unknown device');
  });

  it('cannot exceed ccd`s 512-byte --actor cap, even for astral user-agents', () => {
    const astral = '\u{1F600}'.repeat(200);
    expect(Buffer.byteLength(deviceActor(astral), 'utf8')).toBeLessThanOrEqual(512);
  });

  it('flattens control characters, so no actor can carry a line break into NDJSON', () => {
    expect(deviceActor('a\nb\tc')).toBe('device:a b c');
  });
});
