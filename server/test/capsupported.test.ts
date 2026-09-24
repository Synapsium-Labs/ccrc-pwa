// server/test/capsupported.test.ts
//
// `capSupported` is `stopSurfaceSupported`'s body with the token lifted to a
// parameter — and, critically, WITH ITS DEFAULT UNMOVED. The asymmetry is the
// whole point and `ccdargv.ts`'s own docstring argues it at length: for every
// gated VERB, guessing wrong on no evidence costs a loud failure, so
// `verbSupported` permits; for a FLAG it costs a silent success, so this
// refuses.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ACTOR_FLAGS_CAP, CCD_ARGV, CHILD_ARGV_CAP, RECLAIM_CAP, WIN_SIZE_CAP, capSupported, stopSurfaceSupported, verbSupported,
  deviceActor, type ActorFlags,
} from '../src/ccdargv.js';
import { isExecAllowed } from '../../agent/src/whitelist.js';
import type { DecSurface } from '../../shared/api.js';

const state = (ccdVerbs: string[] | null) => ({ ccdVerbs });

const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const tsFilesUnder = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (
    e.isDirectory() ? tsFilesUnder(path.join(dir, e.name))
      : e.name.endsWith('.ts') ? [path.join(dir, e.name)] : []
  ));
/** How many times `server/src` spells a token in SINGLE OR DOUBLE QUOTES — the
 *  way a TypeScript string literal is written, and the way none of this tree's
 *  prose writes one: every prose mention of these tokens is in BACKTICKS
 *  (measured — with backticks in the class `actor-flags-v1` answers 4 here:
 *  three prose mentions, two in `ccdargv.ts` and one in `coord/dispatch.ts`,
 *  plus the declaration this scan exists to count). Two residuals, disclosed
 *  rather than implied: a
 *  token quoted inside a COMMENT still counts (`'stop-surface'` is quoted in
 *  one of `ccdargv.ts`'s own docstrings, so it answers 2), and a copy built by
 *  concatenation is invisible — the standing limit of any text scan, which is
 *  why this is a second line of defence behind `ccd-archive.test.ts`'s
 *  `toContain`, not the primary one. */
const literalSpellings = (token: string): number => {
  const re = new RegExp(`['"]${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`, 'g');
  return tsFilesUnder(srcRoot)
    .reduce((n, f) => n + (readFileSync(f, 'utf8').match(re)?.length ?? 0), 0);
};

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
    // The title's own claim, measured rather than asserted by the title —
    // added with the win-size case below, which needed the same scan.
    expect(literalSpellings(ACTOR_FLAGS_CAP)).toBe(1);
  });

  it('spells the win-size token exactly once in server/src', () => {
    // The other two spellings are deliberate and elsewhere: ccd's own `echo
    // win-size-v1` and `ccd-archive.test.ts`'s KNOWN_CAPABILITY_TOKENS, which
    // is the pin that holds all three equal. ACTOR_FLAGS_CAP's case above is
    // the shape this copies — plus the scan, so "exactly once" is a
    // measurement and not just this title's word for it. The scan proves it is
    // reading files by finding the one: a scan that read nothing would answer
    // 0 and red here.
    expect(WIN_SIZE_CAP).toBe('win-size-v1');
    expect(literalSpellings(WIN_SIZE_CAP)).toBe(1);
    // AND THE POLARITY THE TOKEN IS READ WITH, asserted here rather than left
    // in a docstring, because the function that will read it lives in wave 3.
    // No evidence REFUSES for this token, where `verbSupported` on the VERB
    // permits — and the verb's presence is not the token's presence.
    expect(capSupported(state(null), WIN_SIZE_CAP)).toBe(false);
    expect(capSupported(undefined, WIN_SIZE_CAP)).toBe(false);
    expect(capSupported(state(['win-size']), WIN_SIZE_CAP)).toBe(false);
    expect(capSupported(state([WIN_SIZE_CAP]), WIN_SIZE_CAP)).toBe(true);
    expect(verbSupported(state(null), ['win-size'])).toBe(true);
  });

  it('spells the reclaim token exactly once in server/src, and it REFUSES on no evidence', () => {
    // Child reclamation, wave 3. The verb this token gates DESTROYS a workspace:
    // `verbSupported` permits on an absent verb list, which is right for verbs
    // that have always existed and exactly wrong here (spec 2026-09-22 §6).
    expect(RECLAIM_CAP).toBe('reclaim-v1');
    expect(literalSpellings(RECLAIM_CAP)).toBe(1);
    expect(capSupported(state(null), RECLAIM_CAP)).toBe(false);
    expect(capSupported(undefined, RECLAIM_CAP)).toBe(false);
    expect(capSupported(state(['ws-reclaim']), RECLAIM_CAP), 'the verb is not the token').toBe(false);
    expect(capSupported(state([RECLAIM_CAP]), RECLAIM_CAP)).toBe(true);
    expect(verbSupported(state(null), ['ws-reclaim'])).toBe(true);
  });

  it('spells the child-argv token exactly once in server/src', () => {
    // The win-size case above is the shape this copies, scan included. The
    // polarity matters more here than for any token before it: `--child` is a
    // FLAG on a verb every box has, so `verbSupported(['ws-add'])` answers
    // TRUE on every box — including the ones whose `cmd_ws_add` would bind
    // `--child` as the project (D-410, one flag to the left). The verb's
    // presence is not the token's presence.
    expect(CHILD_ARGV_CAP).toBe('child-argv-v1');
    expect(literalSpellings(CHILD_ARGV_CAP)).toBe(1);
    expect(capSupported(state(null), CHILD_ARGV_CAP)).toBe(false);
    expect(capSupported(undefined, CHILD_ARGV_CAP)).toBe(false);
    expect(capSupported(state(['ws-add']), CHILD_ARGV_CAP)).toBe(false);
    expect(capSupported(state([CHILD_ARGV_CAP]), CHILD_ARGV_CAP)).toBe(true);
    expect(verbSupported(state(null), ['ws-add'])).toBe(true);
    expect(verbSupported(state(['ws-add']), ['ws-add', '--no-rc', '--child', '7', 'demo'])).toBe(true);
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
    //
    // BARE, no `device:` prefix (final review, F2): every MEASURED label
    // keeps the prefix, so this arm's output can never collide with one.
    // Pre-fix it returned `'device:unmeasured'`, byte-identical to what
    // `deviceActor('unmeasured')` produces from an attacker-chosen
    // `User-Agent: unmeasured` — see the guard describe block below.
    expect(deviceActor(null)).toBe('unmeasured');
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

// Final whole-branch review, F2: `deviceActor(null)` and
// `deviceActor('unmeasured')` used to be byte-identical — the sentinel for
// "no session was ever measured" lived in the SAME namespace as a genuine
// (attacker-influenceable — a UA header is client-chosen) measured label
// spelled the same word. A login with `User-Agent: unmeasured` was recorded
// indistinguishably from "the gate measured nothing at all", two conditions
// an operator reads differently, collapsed by an input the caller controls.
// This is the exact structural check, not a two-sample smoke test: it reds
// the instant the two arms become byte-identical again, for ANY reintroduced
// collision shape, not just this one string.
describe('deviceActor(null) can never collide with a measured label (F2)', () => {
  it('the null arm and a measured "unmeasured" UA are never byte-identical', () => {
    expect(deviceActor(null)).not.toBe(deviceActor('unmeasured'));
  });

  it('the null arm never carries the `device:` prefix a measured label always carries', () => {
    // Restated as a structural property rather than one string: no future
    // measured label — whatever word it carries — can ever equal the null
    // arm, because the null arm is defined to sit outside the `device:`
    // namespace entirely.
    expect(deviceActor(null).startsWith('device:')).toBe(false);
  });
});
