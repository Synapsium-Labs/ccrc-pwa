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
import { readdirSync, readFileSync } from 'node:fs';
import { isPrPhase, type PrPhase } from '../../shared/api.js';

/**
 * The eight phases, derived from the UNION rather than from the runtime list.
 *
 * `PR_PHASES` is module-private in `shared/api.ts` as of verify round 2 (P3) —
 * that unreachability IS the pin against the reversal, so importing it here to
 * make the tests convenient would be re-opening the hole for the tests' sake.
 * `Record<PrPhase, true>` is the stronger statement anyway: add a ninth phase to
 * the union and this literal stops compiling (the tests directory is
 * typechecked — see typecheck-tests.test.ts), and if the runtime list is not
 * updated with it, `isPrPhase` answers false for the new key and the first
 * describe below fails. Two independent failures from one honest source.
 */
const ALL_PHASES: Record<PrPhase, true> = {
  unchecked: true, none: true, 'no-commits': true, open: true,
  draft: true, merged: true, closed: true, unknown: true,
};
const PHASES = Object.keys(ALL_PHASES) as PrPhase[];

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, '..');
const req = createRequire(import.meta.url);
const TSC = path.resolve(path.dirname(req.resolve('typescript')), '..', 'bin', 'tsc');

describe('isPrPhase accepts exactly the eight phases', () => {
  it.each(PHASES)('%s', (phase) => {
    expect(isPrPhase(phase)).toBe(true);
  });

  it('covers the whole union — the runtime list cannot fall behind the type', () => {
    // This is the assertion that used to compare two exported lists. It now
    // compares the union against the VALIDATOR, which is what actually matters
    // and does not require the list to be reachable: a ninth phase added to
    // `PrPhase` forces a key here (the literal is `Record<PrPhase, true>`), and
    // if `shared/api.ts`'s private list was not updated with it, `isPrPhase`
    // answers false and this fails naming the phase.
    expect(PHASES.length).toBe(8);
    for (const phase of PHASES) {
      expect(isPrPhase(phase), `${phase} is in PrPhase but not in the runtime list`).toBe(true);
    }
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

describe('the double-cast shape cannot come back — the constant is not reachable', () => {
  // VERIFY ROUND 2, P3. The previous version of this describe pinned that
  // `PR_PHASES` was cast-HOSTILE, which the reported defect satisfies BY
  // CASTING — the verifier put `registry.ts:85` back to
  //   PR_PHASES.includes(prPhaseRaw as PrPhase) ? (prPhaseRaw as PrPhase) : null
  // and measured tsc clean, the server suite 1005/1005 and typecheck-tests 7/7.
  //
  // A type cannot refuse a cast (measured: a branded `UntrustedField` does not
  // make `raw as PrPhase` an error — TypeScript's comparable relation allows an
  // intersection to be asserted to a constituent's subtype). Making the
  // constant module-private refuses the EXPRESSION instead, one step earlier.
  const run = (): { code: number; out: string } => {
    // Same harness as ccdargv-brand.test.ts: `@ts-expect-error` in a server
    // test is evaluated by nothing, so the only form with teeth is a spawned
    // tsc over a project that includes the fixtures.
    const r = spawnSync(process.execPath,
      [TSC, '-p', 'test/types/tsconfig.prphase.json', '--noEmit'],
      { cwd: serverRoot, encoding: 'utf8' });
    return { code: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
  };
  const result = run();
  const codesFor = (file: string): string[] => {
    const prefix = `test/types/prphase/${file}(`;
    return [...new Set(result.out.split('\n')
      .filter((l) => l.startsWith(prefix))
      .map((l) => /error (TS\d+):/.exec(l)?.[1] ?? 'NO-CODE'))].sort();
  };

  const EXPECTED: Record<string, { what: string; codes: string[] }> = {
    'p1-includes-untrusted-string.ts': {
      what: 'the castless shape — .includes on an untrusted string',
      codes: ['TS2724'],
    },
    'p2-registry-double-cast.ts': {
      what: "the reported defect verbatim, the shape the verifier's reversal used",
      codes: ['TS2724'],
    },
  };

  it('the fixture project does not typecheck', () => {
    expect(result.code, `tsc unexpectedly succeeded:\n${result.out}`).not.toBe(0);
  });

  it('has an expectation for every fixture on disk, and a fixture for every expectation', () => {
    // Same guard as whitelist-structural.test.ts: a fixture added without an
    // expectation, or an expectation whose fixture was deleted, is a hole.
    const onDisk = readdirSync(path.join(serverRoot, 'test', 'types', 'prphase'))
      .filter((f) => f.endsWith('.ts')).sort();
    expect(onDisk).toEqual([...Object.keys(EXPECTED), 'p3-ok-uses-the-validator.ts'].sort());
  });

  it.each(Object.keys(EXPECTED))('%s', (file) => {
    const exp = EXPECTED[file]!;
    // The CODE, not merely "it failed": TS2304 (cannot find name, after a
    // rename or a moved import) would be a broken fixture wearing a passing
    // pin, and TS2345 would mean the constant went back to being exported (that was the
    // code this project asserted before verify round 2).
    expect(codesFor(file), `${exp.what} — expected ${exp.codes.join('+')} from:\n${result.out}`)
      .toEqual(exp.codes);
  });

  it('the positive control in the same project draws no diagnostic at all', () => {
    // Otherwise "shared/api.ts stopped parsing" or "isPrPhase was deleted"
    // satisfies both pins above.
    expect(codesFor('p3-ok-uses-the-validator.ts'), result.out).toEqual([]);
  });

  it('nothing outside shared/api.ts imports the list', () => {
    // The pin is the unreachability, so a single `export` put back — or one
    // consumer re-importing it — restores the whole hole. Asserted as the
    // absence of the import across every source file that could hold one.
    const roots = [path.join(serverRoot, 'src'), path.join(serverRoot, '..', 'shared')];
    const offenders: string[] = [];
    for (const root of roots) {
      for (const f of readdirSync(root).filter((n) => n.endsWith('.ts'))) {
        if (path.basename(f) === 'api.ts') continue;
        const src = readFileSync(path.join(root, f), 'utf8');
        if (/\bPR_PHASES\b/.test(src.replace(/\/\/.*$/gm, ''))) offenders.push(f);
      }
    }
    expect(offenders, 'use isPrPhase — the list is private so the double cast cannot be written')
      .toEqual([]);
  });
}, 120_000);
