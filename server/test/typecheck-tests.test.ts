// FINAL REVIEW, integration finding 4 — `server/test/` was outside the
// typechecker entirely.
//
// `server/tsconfig.json`'s `include` is `["src/**/*.ts","../shared/**/*.ts"]`.
// Fifty test files and their helpers were never compiled by any gate, and a
// live `TS2769` in `fleet.test.ts:178` (a `PrState` literal missing the
// REQUIRED `retryAt`) sat there undetected — reproduced independently on
// `4e8b689` under a temporary tests-inclusive project, and now fixed. The
// review's answer to "how many others hide there" is zero, which this file
// makes a standing fact rather than a one-off measurement: a whole directory
// outside the typechecker is how the one error hid, and it would be how the
// next one hides.
//
// WHY A SPAWNED tsc AND NOT A WIDER `include`: `npm run build` uses
// `tsconfig.json` with `outDir: dist`, so adding `test/**` there would emit the
// test suite into the shipped build. And why a TEST rather than a new gate
// command: the controller's gate list already runs this suite, so wiring the
// check in here means it cannot be forgotten at the point where gates are
// counted. Same mechanism as `ccdargv-brand.test.ts`, which has spawned tsc
// from inside the suite since task 13S.
//
// `test/types/**` is excluded by the project: those are the deliberately
// non-compiling brand-bypass and whitelist-bypass fixtures, which have their
// own projects and are asserted to FAIL by `ccdargv-brand.test.ts` and
// `agent/test/whitelist-structural.test.ts`.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, '..');
const agentRoot = path.resolve(here, '..', '..', 'agent');

// `typescript/bin/tsc` is not an exported subpath, so resolve the package's
// main entry and walk to the bin next to lib/ — a bare `tsc` would depend on
// PATH.
const req = createRequire(import.meta.url);
const TSC = path.resolve(path.dirname(req.resolve('typescript')), '..', 'bin', 'tsc');

function typecheck(cwd: string, project: string, extra: string[] = []): { code: number; out: string } {
  const r = spawnSync(process.execPath, [TSC, '-p', project, '--noEmit', ...extra], {
    cwd, encoding: 'utf8',
  });
  return { code: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/** Absolute paths of every file tsc actually put in the program. */
const programFiles = (cwd: string, project: string): string[] =>
  typecheck(cwd, project, ['--listFiles']).out
    .split('\n').map((l) => l.trim()).filter((l) => l.startsWith('/'));

describe('every test file typechecks — the directory the gates could not see', () => {
  it('server/test/ is clean under a tests-inclusive project', () => {
    const r = typecheck(serverRoot, 'test/tsconfig.tests.json');
    expect(r.out, `server/test/ has type errors:\n${r.out}`).toBe('');
    expect(r.code).toBe(0);
  }, 120_000);

  it('agent/test/ is clean under a tests-inclusive project', () => {
    // The agent's tsconfig excludes `test/` for the same reason and was
    // measured clean; the point of checking it is that it STAYS clean.
    const r = typecheck(agentRoot, 'test/tsconfig.tests.json');
    expect(r.out, `agent/test/ has type errors:\n${r.out}`).toBe('');
    expect(r.code).toBe(0);
  }, 120_000);
});

describe('the tests-inclusive projects really do cover the directory', () => {
  // Without these, a `tsconfig.tests.json` whose `include` had drifted to match
  // nothing would report "clean" forever — a gate that cannot fail, which is
  // exactly what the excluded directory already was.
  it.each([
    ['server', serverRoot],
    ['agent', agentRoot],
  ])('%s: the project includes test/, src/ and shared/, and excludes the broken fixtures', (_pkg, root) => {
    const cfgPath = path.join(root, 'test', 'tsconfig.tests.json');
    expect(existsSync(cfgPath)).toBe(true);
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf8')) as {
      include: string[]; exclude: string[]; compilerOptions: { noEmit: boolean };
    };
    expect(cfg.include).toContain('./**/*.ts');
    expect(cfg.include).toContain('../src/**/*.ts');
    expect(cfg.include).toContain('../../shared/**/*.ts');
    expect(cfg.exclude).toContain('types/**');
    // `noEmit`, because the base config carries `outDir: dist` and a
    // typechecking gate must never write build output.
    expect(cfg.compilerOptions.noEmit).toBe(true);
  });

  // The assertions above check what the CONFIG says. These check what tsc
  // actually loaded — the difference between "the include looks right" and
  // "the files are in the program". An `include` that silently matched nothing
  // would report clean forever, which is precisely what the excluded directory
  // already was: a gate that could not fail.
  it('the server program really contains every test file on disk', () => {
    const files = programFiles(serverRoot, 'test/tsconfig.tests.json');
    const onDisk = readdirSync(here).filter((f) => f.endsWith('.ts'));
    expect(onDisk.length).toBeGreaterThan(40);
    for (const f of onDisk) {
      expect(files, `${f} is on disk but not in the typechecked program`)
        .toContain(path.join(here, f));
    }
    // The helpers too — `helpers.ts`/`ccdPrHelpers.ts` are not `*.test.ts`, so
    // a `test/**/*.test.ts` include would have missed exactly the files most
    // shared between suites.
    expect(files).toContain(path.join(here, 'helpers.ts'));
  }, 120_000);

  it('the agent program really contains every test file on disk', () => {
    const agentTests = path.join(agentRoot, 'test');
    const files = programFiles(agentRoot, 'test/tsconfig.tests.json');
    const onDisk = readdirSync(agentTests).filter((f) => f.endsWith('.ts'));
    expect(onDisk.length).toBeGreaterThan(5);
    for (const f of onDisk) {
      expect(files, `${f} is on disk but not in the typechecked program`)
        .toContain(path.join(agentTests, f));
    }
  }, 120_000);

  it('and it does NOT contain the fixtures that are supposed to be broken', () => {
    // If `types/**` ever stopped being excluded, this gate would go permanently
    // red on files whose whole job is to fail — and the reflex fix would be to
    // delete the pins. Assert the exclusion rather than discover it that way.
    const server = programFiles(serverRoot, 'test/tsconfig.tests.json');
    const agent = programFiles(agentRoot, 'test/tsconfig.tests.json');
    for (const f of [...server, ...agent]) {
      expect(f, `${f} is a deliberately non-compiling fixture`).not.toMatch(/[/]test[/]types[/]/);
    }
    // Positive control on the exclusion: the fixtures do exist on disk, so the
    // assertion above is not passing because there is nothing to exclude.
    expect(readdirSync(path.join(here, 'types', 'bypasses')).length).toBeGreaterThan(0);
    expect(readdirSync(path.join(agentRoot, 'test', 'types', 'bypasses')).length).toBeGreaterThan(0);
  }, 120_000);
});
