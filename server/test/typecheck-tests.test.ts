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
  //
  // FINAL REVIEW ROUND 2, gates finding 4 — WHY THIS ENUMERATES.
  // The first version of this gate read `readdirSync(here)`, where `here` is
  // `server/test/`. It therefore checked, exhaustively and correctly, the one
  // directory that was already covered — and could not see `server/test-e2e/`,
  // 225 lines in NO project, sitting one directory over from the hole it was
  // written to prevent recurring. A gate against "a whole directory is outside
  // the typechecker" that takes the directory as an input cannot fail for the
  // reason it exists. So the directory list is DISCOVERED from the package
  // root, and the only thing hardcoded is the exemption — which is short,
  // justified per entry, and asserted below to still describe something real.
  // Same correction, same reasoning, as `agent/test/tmpfixtures.test.ts`'s
  // move from a two-name file list to a directory scan.
  const IGNORED_DIRS = new Set(['node_modules', 'dist', 'coverage', '.vite']);

  /** Every `.ts` file in a package that some typecheck project must contain.
   *  Discovered by walking the package root, not listed. */
  function typeSources(root: string): string[] {
    const out: string[] = [];
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (IGNORED_DIRS.has(e.name) || e.name.startsWith('.')) continue;
          // `test/types/**` and `test-e2e/types/**` are the deliberately
          // non-compiling brand- and whitelist-bypass fixtures. They are NOT
          // unchecked: they have their own projects and are asserted to FAIL by
          // `ccdargv-brand.test.ts` and `agent/test/whitelist-structural.test.ts`.
          // The positive control for this skip is the last test in this file.
          if (e.name === 'types' && path.basename(dir).startsWith('test')) continue;
          walk(abs);
          continue;
        }
        if (e.name.endsWith('.ts') && !e.name.endsWith('.d.ts')) out.push(abs);
      }
    };
    walk(root);
    return out.sort();
  }

  /** The union of everything the package's own projects put in a program. */
  const covered = (root: string, projects: string[]): Set<string> =>
    new Set(projects.flatMap((p) => programFiles(root, p)));

  const PACKAGES: [pkg: string, root: string, projects: string[], floor: number][] = [
    ['server', serverRoot, ['tsconfig.json', 'test/tsconfig.tests.json'], 100],
    ['agent', agentRoot, ['tsconfig.json', 'test/tsconfig.tests.json'], 15],
  ];

  it.each(PACKAGES)('%s: EVERY .ts file in the package is in some typecheck project — directories discovered, not listed',
    (pkg, root, projects, floor) => {
      const inProgram = covered(root, projects);
      const onDisk = typeSources(root);

      // Guard the guard, both directions. A walk that found nothing would pass
      // every assertion below without checking anything — the same "gate that
      // cannot fail" this whole file exists to retire.
      expect(onDisk.length, `the ${pkg} walk found almost no .ts files`).toBeGreaterThan(floor);

      const uncovered = onDisk.filter((f) => !inProgram.has(f));
      expect(uncovered.map((f) => path.relative(root, f)),
        `these ${pkg} files are compiled by NO typecheck project — the shape that hid a live TS2769 in fleet.test.ts and then hid test-e2e/`)
        .toEqual([]);

      // And the directories are genuinely plural, so a package that collapsed
      // to a single directory could not make this pass by shrinking.
      const dirs = new Set(onDisk.map((f) => path.relative(root, f).split(path.sep)[0]));
      expect(dirs.size, `${pkg} covered only ${[...dirs].join(', ')}`).toBeGreaterThan(1);
    }, 240_000);

  it('server: the discovery would actually notice a new sibling directory', () => {
    // The failure mode this gate replaces was silent, so "no uncovered files"
    // must be shown to be a measurement and not a vacuous truth. `test-e2e/`
    // is the directory that was invisible to the previous version of this
    // gate; it must now be BOTH discovered by the walk and present in a
    // program. Naming it here is a positive control, not the coverage rule —
    // the rule above names no directory at all.
    const onDisk = typeSources(serverRoot).map((f) => path.relative(serverRoot, f));
    expect(onDisk, 'the walk no longer discovers test-e2e/')
      .toContain(path.join('test-e2e', 'session.e2e.test.ts'));
    expect(onDisk, 'the walk no longer discovers the vitest configs at the package root')
      .toContain('vitest.e2e.config.ts');
    const inProgram = covered(serverRoot, ['tsconfig.json', 'test/tsconfig.tests.json']);
    expect([...inProgram].some((f) => f.includes(`${path.sep}test-e2e${path.sep}`)),
      'test-e2e/ is back outside every typecheck project').toBe(true);
  }, 240_000);

  it('the helpers are covered too, not just the *.test.ts files', () => {
    // `helpers.ts`/`ccdPrHelpers.ts` are not `*.test.ts`, so a
    // `test/**/*.test.ts` include would have missed exactly the files most
    // shared between suites.
    const files = programFiles(serverRoot, 'test/tsconfig.tests.json');
    expect(files).toContain(path.join(here, 'helpers.ts'));
    expect(files).toContain(path.join(serverRoot, 'test-e2e', 'helpers.ts'));
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
