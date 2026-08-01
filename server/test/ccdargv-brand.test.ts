// The replacement for layer 2b (task 13S). Layer 2b asserted "every ccd argv is
// built in ccdargv.ts and nowhere else" by scanning the source TEXT of `src/`,
// and four consecutive rounds defeated it with four different ways of naming a
// value. The property is now carried by two type facts —
//
//   * `CCD_ARGV`'s entries return `CcdArgv`, a nominally branded
//     `readonly string[]` whose single minting cast lives in `ccdargv.ts`;
//   * `Deps` has no raw `run`, only `runCcd: (argv: CcdArgv) => …`
//
// — and this file is what stops a deleted regex from becoming a deleted
// guarantee. It compiles two fixture projects under `test/types/`: the
// `bypasses/` one MUST fail, with the exact error asserted per file (so a
// fixture that starts failing for some unrelated reason — a typo, a moved
// import — is a failure here rather than a pin quietly gone decorative), and
// the `ok/` one MUST pass, so "nothing compiles" cannot satisfy the pins.
//
// WHY A SEPARATE tsc RUN AND NOT `@ts-expect-error`: `server/tsconfig.json`
// does not include `test/`, and vitest has no typecheck block, so an
// `@ts-expect-error` written in a server test is never evaluated by any gate —
// it would be a pin that cannot fail. Spawning tsc over a project that DOES
// include the fixtures is the only form with teeth here.
//
// WHAT THIS DOES NOT COVER, disclosed rather than implied: a deliberate cast
// (`['ws-rm','x'] as unknown as CcdArgv`) still mints an argv, exactly as
// `(deps.tmux as unknown as { run: Runner }).run` still reaches Tmux's private
// runner — the type system does not defend against a caller who writes down
// that they are lying. It also cannot see a NEW class that is handed a raw
// `Runner` by `index.ts`; layer 2b's `this.run(` ban did cover that shape, and
// that coverage is not replaced. What is closed is the class layer 2b kept
// losing to: ordinary code, honestly written, that names a value some way the
// scanner had not been taught.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CCD_ARGV } from '../src/ccdargv.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, '..');
const bypassDir = path.join(here, 'types', 'bypasses');

// `typescript/bin/tsc` is not an exported subpath, so resolve the package's
// main entry and walk to the bin next to lib/ — a bare `tsc` would depend on
// PATH, which is not something a test should be at the mercy of.
const req = createRequire(import.meta.url);
const TSC = path.resolve(path.dirname(req.resolve('typescript')), '..', 'bin', 'tsc');

function typecheck(project: string): { code: number; out: string } {
  const r = spawnSync(process.execPath, [TSC, '-p', project, '--noEmit'], {
    cwd: serverRoot, encoding: 'utf8',
  });
  return { code: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

const bypasses = typecheck('test/types/tsconfig.bypasses.json');
const positive = typecheck('test/types/tsconfig.ok.json');

/** Every distinct `TSxxxx` code tsc reported against one bypass fixture. */
const codesFor = (file: string): string[] => {
  const prefix = `test/types/bypasses/${file}(`;
  const codes = bypasses.out.split('\n')
    .filter((l) => l.startsWith(prefix))
    .map((l) => /error (TS\d+):/.exec(l)?.[1] ?? 'NO-CODE');
  return [...new Set(codes)].sort();
};

/** The four historical bypasses, plus the two extra pins task 13S names. The
 *  CODES are asserted, not merely "it failed": a fixture failing on TS2304
 *  (cannot find name) would be a broken fixture wearing a passing pin. */
const EXPECTED: Record<string, { what: string; codes: string[] }> = {
  'b1-inline-literal.ts':     { what: 'inline array literal at the call site', codes: ['TS2345'] },
  'b2-extracted-const.ts':    { what: 'the array extracted to a const first', codes: ['TS2345'] },
  'b3-aliased-runner.ts':     { what: 'the runner aliased into a local', codes: ['TS2339'] },
  'b4-renamed-identifier.ts': { what: "a rename onto runCcd's own parameter name", codes: ['TS2339', 'TS2345'] },
  'b5-aliased-namespace.ts':  { what: 'the CCD_ARGV namespace aliased, argv still raw', codes: ['TS2345'] },
  'b6-no-run-on-deps.ts':     { what: 'Deps carries no raw runner at all', codes: ['TS2339'] },
};

describe('the CcdArgv brand — every historical layer-2b bypass now fails to COMPILE', () => {
  it('the bypass fixture project does not typecheck', () => {
    expect(bypasses.code, `tsc unexpectedly succeeded:\n${bypasses.out}`).not.toBe(0);
  });

  // Same guard as SAMPLES in whitelist-subset.test.ts: a fixture added without
  // an expectation, or an expectation whose fixture was deleted, is a hole.
  it('has an expectation for every fixture on disk, and a fixture for every expectation', () => {
    expect(readdirSync(bypassDir).filter((f) => f.endsWith('.ts')).sort())
      .toEqual(Object.keys(EXPECTED).sort());
  });

  it.each(Object.keys(EXPECTED))('%s', (file) => {
    const exp = EXPECTED[file]!;
    expect(codesFor(file), `${exp.what} — expected ${exp.codes.join('+')} from:\n${bypasses.out}`)
      .toEqual(exp.codes);
  });
});

describe('the CcdArgv brand — the pins are not a blanket refusal', () => {
  it('the legitimate call site compiles clean', () => {
    expect(positive.out).toBe('');
    expect(positive.code).toBe(0);
  });

  // Without this, emptying the positive control would make the test above pass
  // trivially while removing the only evidence the brand is usable at all.
  it('the positive control really does drive runCcd through CCD_ARGV', () => {
    const src = readFileSync(path.join(here, 'types', 'ok', 'legit-call-site.ts'), 'utf8');
    expect(src.split('deps.runCcd(').length - 1).toBeGreaterThanOrEqual(3);
    expect(src).toContain('CCD_ARGV.');
    // No cast anywhere: the legitimate shapes must flow on their own.
    expect(src).not.toContain('as CcdArgv');
  });
});

describe('the CcdArgv brand is phantom — it costs nothing at runtime', () => {
  it('an entry still returns a plain array of exactly the argv tokens', () => {
    const argv = CCD_ARGV.ensure('demo-quiet-basin');
    expect(Array.isArray(argv)).toBe(true);
    expect(Object.getOwnPropertySymbols(argv)).toEqual([]);
    expect([...argv]).toEqual(['ensure', 'demo-quiet-basin']);
  });
});
