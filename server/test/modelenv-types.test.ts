// Fix round 1, finding 1: `shared/modelenv.d.mts` declared `ModelEnv` as an
// `interface`, and `mergeSettingsEnv`'s `block` parameter as
// `Record<string, string>`. Interfaces carry no implicit index signature, so
// the module's own canonical composition —
// `mergeSettingsEnv(p, modelEnvBlock(reg, cat))` — failed under a standalone
// `tsc --strict --module NodeNext`: TS2345, "Index signature for type
// 'string' is missing in type 'ModelEnv'". `export type ModelEnv = { … }`
// compiles clean against the SAME probe.
//
// AND IT WAS UNMEASURED: `server/tsconfig.json`'s `include` is
// `["src/**/*.ts", "../shared/**/*.ts", "../shared/**/*.mjs"]` — no `*.d.mts`
// glob — so `shared/modelenv.d.mts` only enters a compiler program when
// something INSIDE that program imports the sibling `.mjs` and TypeScript
// pulls the companion declaration file in to type it. `shared/models.d.mts`
// gets in this way (`shared/models.ts` imports `./models.mjs`, and
// `models.ts` is globbed by `../shared/**/*.ts`); nothing does the same for
// `shared/modelenv.mjs` until Task 6's `deploy/models-op.mjs` lands. So a
// plain `npx tsc --noEmit` in `server/` — the command Task 3's own report
// ran — never touched this file at all.
//
// This test is the measurement. `server/test/types/ok/` is this repo's
// existing "must compile clean" positive-control directory —
// `ccdargv-brand.test.ts`'s `positive` check already spawns tsc over
// `test/types/tsconfig.ok.json` (`include: ["ok/**/*.ts"]`) and asserts exit
// code 0, so `legit-modelenv-composition.ts` needed no new project, only a
// new file in the existing one. This file re-runs that SAME project (so it
// fails on its own, attributably, rather than only as a side effect of the
// ccdargv suite) and additionally pins that the probe still drives the two
// compositions the ruling named, so emptying it could not make the pin pass
// by accident.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, '..');
const probePath = path.join(here, 'types', 'ok', 'legit-modelenv-composition.ts');
const contextTokensProbePath = path.join(here, 'types', 'ok', 'legit-client-default-context-tokens.ts');

// Same harness as `ccdargv-brand.test.ts` and `typecheck-tests.test.ts`:
// `typescript/bin/tsc` is not an exported subpath, so resolve the package's
// main entry and walk to the bin next to `lib/` rather than depend on PATH.
const req = createRequire(import.meta.url);
const TSC = path.resolve(path.dirname(req.resolve('typescript')), '..', 'bin', 'tsc');

function typecheck(project: string): { code: number; out: string } {
  const r = spawnSync(process.execPath, [TSC, '-p', project, '--noEmit'], {
    cwd: serverRoot, encoding: 'utf8',
  });
  return { code: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

describe('shared/modelenv.d.mts — measured, not merely believed clean (fix round 1, finding 1)', () => {
  it("the module's own canonical composition compiles clean", () => {
    const r = typecheck('test/types/tsconfig.ok.json');
    expect(r.out, `test/types/ok/ has type errors:\n${r.out}`).toBe('');
    expect(r.code).toBe(0);
  }, 120_000);

  it('the probe really does drive mergeSettingsEnv(p, modelEnvBlock(reg, cat)) and clearSettingsEnv(p, MODEL_ENV_KEYS)', () => {
    // Without this, emptying the probe file would make the check above pass
    // trivially while removing the only evidence `ModelEnv` is usable at the
    // one call site the design actually makes.
    const src = readFileSync(probePath, 'utf8');
    expect(src).toContain('mergeSettingsEnv(settingsPath, modelEnvBlock(reg, cat))');
    expect(src).toContain('clearSettingsEnv(settingsPath, MODEL_ENV_KEYS)');
    // No cast anywhere: the legitimate shape has to flow on its own.
    expect(src).not.toContain(' as ');
  });

  it('the CLIENT_DEFAULT_CONTEXT_TOKENS probe really does import and use it', () => {
    // Without this, emptying the probe file would make the check above pass
    // trivially while removing the only evidence this declaration is in a
    // compiled program at all.
    const src = readFileSync(contextTokensProbePath, 'utf8');
    expect(src).toContain("import { CLIENT_DEFAULT_CONTEXT_TOKENS } from '../../../../shared/modelenv.mjs'");
    expect(src).toContain('CLIENT_DEFAULT_CONTEXT_TOKENS');
  });

  it('ModelEnv is a type alias, not an interface — the fact the whole finding turns on', () => {
    const src = readFileSync(path.join(serverRoot, '..', 'shared', 'modelenv.d.mts'), 'utf8');
    expect(src).toContain('export type ModelEnv = {');
    expect(src).not.toMatch(/export interface ModelEnv/);
  });
});
