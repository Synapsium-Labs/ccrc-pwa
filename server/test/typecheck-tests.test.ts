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
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, '..');
const agentRoot = path.resolve(here, '..', '..', 'agent');
const pwaRoot = path.resolve(here, '..', '..', 'pwa');

// `typescript/bin/tsc` is not an exported subpath, so resolve the package's
// main entry and walk to the bin next to lib/ — a bare `tsc` would depend on
// PATH.
const req = createRequire(import.meta.url);
const TSC = path.resolve(path.dirname(req.resolve('typescript')), '..', 'bin', 'tsc');

// pwa pins `typescript ~6.0.2`; server/agent pin `^7.0.2` — different majors,
// not just different patch levels (measured: 6.0.3 vs 7.0.2 installed today).
// `cwd` alone does NOT make `TSC` above check pwa under pwa's own compiler:
// TS 7's `tsc` entrypoint is a thin shim that shells out to a native binary
// resolved via `@typescript/typescript-<platform>`, and that resolution is
// anchored to `getExePath.js`'s OWN location inside `typescript/lib/`, not to
// the spawned process's `cwd`. So `TSC` always runs server's 7.0.2 native
// binary regardless of which project it is pointed at — spawning it against
// `pwa/tsconfig.json` would silently substitute a compiler pwa's own
// `npm run build` and CI's `Typecheck` step never run. `PWA_TSC` resolves
// `typescript` from pwa's own package.json instead, so the binary that
// actually runs is the one under `pwa/node_modules` (verified: `--version`
// there reports 6.0.3, matching pwa's pin).
const pwaReq = createRequire(pathToFileURL(path.join(pwaRoot, 'package.json')).href);
const PWA_TSC = path.resolve(path.dirname(pwaReq.resolve('typescript')), '..', 'bin', 'tsc');

function typecheck(cwd: string, project: string, extra: string[] = [], tsc: string = TSC): { code: number; out: string } {
  const r = spawnSync(process.execPath, [tsc, '-p', project, '--noEmit', ...extra], {
    cwd, encoding: 'utf8',
  });
  return { code: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/** Absolute paths of every file tsc actually put in the program. */
const programFiles = (cwd: string, project: string, tsc: string = TSC): string[] =>
  typecheck(cwd, project, ['--listFiles'], tsc).out
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

// pwa's gap is shaped differently from server's and agent's, so it gets its own
// describe rather than a third row above. `pwa/tsconfig.json` ALREADY includes
// `src`, `test`, `vite.config.ts` and `../shared` (measured: every .ts/.tsx file
// on disk under pwa/ lives under one of those, so there is no excluded
// directory to add a `test/tsconfig.tests.json` project for). The hole is not
// "a directory outside every project" — it is that NOTHING inside `vitest run`
// (pwa's `npm test`) ever asks tsc to check that project. `pwa/vite.config.ts`
// sets `test.typecheck.enabled = true`, but Vitest's typecheck runner only
// type-checks files matching its own default `typecheck.include`
// (`**/*.{test,spec}-d.?(c|m)[jt]s?(x)`, `vitest/dist/chunks/defaults.*.js`) —
// exactly `test/auth-wire.test-d.ts` and `test/sheet.test-d.tsx`, both
// deliberate type-level assertions, not a whole-project check. So a broken
// type anywhere else under `src/`, `test/` or `../shared` (which pwa bundles)
// is invisible to `vitest run` and thus to this repo's own convention of
// running each package by `cd pwa && npm run test` — pwa/vite.config.ts's own
// comment on `typecheck.enabled` already says as much: "the only thing that
// catches a revert is a separate `tsc --noEmit` nobody is obliged to run".
// That separate check exists — CI's `Typecheck` step and `npm run build` both
// run pwa's `tsconfig.json` — but both are plumbing outside any vitest suite,
// exactly the kind of gate this file's own header explains a spawned tsc
// closes: once the check is a vitest assertion, it is inside the same gate
// list as everything else in this file and cannot be silently dropped.
describe('pwa: the whole package typechecks — vitest\'s own typecheck mode does not reach it', () => {
  it('pwa/ is clean under tsconfig.json', () => {
    // PWA_TSC, not TSC: this must be the SAME compiler pwa's own `npm run
    // build` and CI's `Typecheck` step run, or the failure message below
    // (and the equivalence it claims) would be false. See PWA_TSC's comment.
    const r = typecheck(pwaRoot, 'tsconfig.json', [], PWA_TSC);
    expect(r.out, `pwa has type errors that only 'npm run build' or CI's separate Typecheck step would catch:\n${r.out}`).toBe('');
    expect(r.code).toBe(0);
  }, 120_000);

  it('PWA_TSC really is pwa\'s own installed compiler, not the server-resolved one', () => {
    // Guard the guard: if this ever collapsed back to the shared `TSC`
    // constant, the assertion above would silently start measuring pwa's
    // project with whatever major server/agent happen to pin instead of
    // pwa's own — exactly the equivalence-that-isn't this file used to ship.
    expect(PWA_TSC.startsWith(pwaRoot + path.sep), `PWA_TSC (${PWA_TSC}) is not under pwa's own node_modules`).toBe(true);
    const pwaPkg = JSON.parse(readFileSync(path.join(pwaRoot, 'node_modules', 'typescript', 'package.json'), 'utf8')) as { version: string };
    const r = spawnSync(process.execPath, [PWA_TSC, '--version'], { encoding: 'utf8' });
    expect(r.stdout).toContain(pwaPkg.version);
  });
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

  /** Every `.ts`/`.tsx` file in a package that some typecheck project must
   *  contain. Discovered by walking the package root, not listed.
   *  `.tsx` matters here specifically for pwa: server and agent are pure
   *  backend TypeScript with zero `.tsx` files, so a filter that only
   *  matched `.ts` happened to be complete for both of them — and would
   *  have silently dropped 104 of pwa's 170 source files (every component
   *  and screen) from this census the moment pwa was added, the same "one
   *  directory looked covered because the check couldn't see the rest"
   *  shape this file's header already warns about, one file-extension over. */
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
        // `__`-prefixed entries are TRANSIENT mutants written by a parallel
        // suite (`boot.test.ts` writes `server/src/__boot_control_mutant__.ts`
        // for ~15s, removed in its `finally`). Same guard, same reason, as
        // `single-definition.test.ts`'s `sources` and `run-routes.test.ts`'s
        // `sourcesUnder` — without it this census is the one suite in the
        // repo that reds on the window, which is exactly the "typecheck-tests
        // load flake" every full-suite run kept re-diagnosing (it was never
        // load: it was this race, and it finally fired on the quiet CI box).
        if (e.name.startsWith('__')) continue;
        // `.d.ts` is a real, common exclusion (declaration files, not
        // sources to typecheck); `.d.tsx` is not a TypeScript-recognized
        // extension at all, so no analogous exclusion exists for it.
        if (e.name.endsWith('.tsx') || (e.name.endsWith('.ts') && !e.name.endsWith('.d.ts'))) out.push(abs);
      }
    };
    walk(root);
    return out.sort();
  }

  /** The union of everything the package's own projects put in a program. */
  const covered = (root: string, projects: string[], tsc: string = TSC): Set<string> =>
    new Set(projects.flatMap((p) => programFiles(root, p, tsc)));

  const PACKAGES: [pkg: string, root: string, projects: string[], floor: number, tsc: string][] = [
    ['server', serverRoot, ['tsconfig.json', 'test/tsconfig.tests.json'], 100, TSC],
    ['agent', agentRoot, ['tsconfig.json', 'test/tsconfig.tests.json'], 15, TSC],
    // pwa gets ONE project, not two. Unlike server/agent, `pwa/tsconfig.json`
    // never excluded `test/` in the first place (it already sets `noEmit:
    // true` and lists `src`, `test`, `vite.config.ts` and `../shared` in one
    // `include` — there was never a build-vs-tests split to bridge with a
    // second `tsconfig.tests.json`), so a second project here would just be a
    // duplicate of the first with nothing new to include. Measured 170 .ts/
    // .tsx files on disk under pwa/ (88 src, 81 test, 1 vite.config.ts); 100
    // is a floor with real slack under that, not a rounding of it.
    // PWA_TSC, not TSC — same reason as the clean-check above: pwa's own
    // compiler, not server's, must be the one deciding what's "in program".
    ['pwa', pwaRoot, ['tsconfig.json'], 100, PWA_TSC],
  ];

  it.each(PACKAGES)('%s: EVERY .ts file in the package is in some typecheck project — directories discovered, not listed',
    (pkg, root, projects, floor, tsc) => {
      const inProgram = covered(root, projects, tsc);
      const onDisk = typeSources(root);

      // Guard the guard, both directions. A walk that found nothing would pass
      // every assertion below without checking anything — the same "gate that
      // cannot fail" this whole file exists to retire.
      //
      // CORRECTION to df550077's commit message: it closed with "The floor is
      // not what catches [the missing-.tsx regression]; the extension match
      // is." That is true only of the COMPOUND mutation described one
      // sentence earlier (extension clause removed AND floor also lowered to
      // 50 — 61% of pwa invisible and green). Under the single mutation of
      // just deleting the `.tsx` clause above, with the floor left at 100 as
      // shipped, THIS assertion is exactly what reds (66 onDisk vs floor
      // 100) — the floor is today's real catch for that regression, not
      // immune to it. What the extension match uniquely buys is that
      // correctness stops depending on whatever floor value someone later
      // picks; it is not what fires today.
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
