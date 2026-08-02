// FINAL REVIEW, integration finding 3 — `PR_PHASES: readonly PrPhase[]` forced
// a double cast, and `registry.ts:80` took it:
//
//     PR_PHASES.includes(prPhaseRaw as PrPhase) ? (prPhaseRaw as PrPhase) : null
//
// three lines below a comment in `shared/api.ts` stating the rule it breaks:
// "Cast the CONSTANT, never the input."
//
// HONEST SCOPE, because "reproduce before fixing" applies here too: this is a
// type-hygiene fix and NO distinguishing runtime input exists. Both forms do an
// exact-match `.includes` over the same eight strings, and `null as PrPhase` is
// not in the array, so the old code fell through to `null` correctly for every
// value the registry can produce. I looked for a separator and there is none by
// construction — the cast is erased at runtime, so the compiled `includes` call
// is byte-identical. What was wrong was the shape, not the behaviour: an
// assertion standing where a check belongs reads as validated, and survives the
// refactor that makes it false (the raw read becomes `unknown`; the phase list
// becomes config-driven; a half-written registry hands over a number).
//
// So the pins here are the two things that CAN be pinned: the predicate's own
// behaviour, including the non-string cases the old expression could not
// express, and — via a compile fixture — the fact that `PR_PHASES` stays
// cast-hostile, so widening it to `readonly string[]` cannot quietly make the
// double-cast shape legal again.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PR_PHASES, isPrPhase, type PrPhase } from '../../shared/api.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, '..');
const req = createRequire(import.meta.url);
const TSC = path.resolve(path.dirname(req.resolve('typescript')), '..', 'bin', 'tsc');

describe('isPrPhase accepts exactly the eight phases', () => {
  it.each([...PR_PHASES])('%s', (phase) => {
    expect(isPrPhase(phase)).toBe(true);
  });

  it('covers the whole union — no phase is missing from PR_PHASES', () => {
    // If a ninth phase is added to `PrPhase` and not to `PR_PHASES`, this
    // literal stops compiling (the tests directory is typechecked now — see
    // typecheck-tests.test.ts), so the list cannot silently fall behind the
    // type it validates against.
    const all: Record<PrPhase, true> = {
      unchecked: true, none: true, 'no-commits': true, open: true,
      draft: true, merged: true, closed: true, unknown: true,
    };
    expect(Object.keys(all).sort()).toEqual([...PR_PHASES].sort());
  });
});

describe('isPrPhase rejects everything else, without asserting its way past the check', () => {
  it.each([
    'Open', 'OPEN', 'open ', ' open', 'ope', 'opened', 'reopened',
    'ready', 'merge', '', 'null', 'undefined', '__proto__', 'constructor',
    'toString', 'includes', 'length',
  ])('rejects the string %j', (v) => {
    expect(isPrPhase(v)).toBe(false);
  });

  it.each([
    ['null', null], ['undefined', undefined], ['a number', 7],
    ['a boolean', true], ['an object', { phase: 'open' }],
    ['an array of the right strings', ['open']],
    ['a String object', new String('open')],
  ])('rejects %s', (_label, v) => {
    // The non-string cases are the ones the old expression could not state at
    // all: `PR_PHASES.includes(x as PrPhase)` has to lie about the type before
    // it can ask the question. The predicate takes `unknown` and checks first.
    expect(isPrPhase(v)).toBe(false);
  });

  it('a narrowed value is usable as a PrPhase with no cast at the call site', () => {
    const raw: unknown = 'merged';
    let out: PrPhase | null = null;
    if (isPrPhase(raw)) out = raw;   // no `as` anywhere — that is the point
    expect(out).toBe('merged');
  });
});

describe('PR_PHASES stays cast-hostile, so the double-cast shape cannot come back', () => {
  it('`PR_PHASES.includes(someUntrustedString)` does not compile', () => {
    // Same harness as ccdargv-brand.test.ts: `@ts-expect-error` in a server
    // test is evaluated by nothing, so the only form with teeth is a spawned
    // tsc over a project that includes the fixture.
    const r = spawnSync(process.execPath,
      [TSC, '-p', 'test/types/tsconfig.prphase.json', '--noEmit'],
      { cwd: serverRoot, encoding: 'utf8' });
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    expect(r.status, `tsc unexpectedly succeeded:\n${out}`).not.toBe(0);
    // The CODE, not merely "it failed": TS2304 (cannot find name, after a
    // rename or a moved import) would be a broken fixture wearing a passing pin.
    expect(out).toMatch(/p1-includes-untrusted-string\.ts\(\d+,\d+\): error TS2345:/);
    expect(out).toMatch(/not assignable to parameter of type 'PrPhase'/);
  }, 120_000);
});
