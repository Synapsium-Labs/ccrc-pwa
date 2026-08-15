// The build can succeed and still produce a server that cannot start.
//
// `tsc` picks each file's emit format from the nearest package.json ABOVE THE
// SOURCE, not above the output. `shared/` had none, so NodeNext called it
// CommonJS and wrote `exports.composePrompt = ...` into dist/shared/ — while
// dist/ sits under server/package.json, which is `"type": "module"`. Node then
// refused the import ("does not provide an export named 'composePrompt'") and
// the service crash-looped in production. Nothing caught it: vitest and tsx
// both load the .ts directly, `tsc --noEmit` type-checks without emitting, and
// `npm run build` exits 0.
//
// This pins the invariant structurally, so it fails in milliseconds rather than
// on the box: every source root the server compiles must be governed by a
// package.json declaring ESM. agent/tsconfig.json has the identical include
// shape and was exposed to the same bug; both are covered by the one
// shared/package.json this asserts, so it is not duplicated over there.
//
// The include list now also carries `../shared/**/*.mjs` (with `allowJs`), so
// that `shared/generate.mjs` and `shared/mark.mjs` reach `dist/shared/` —
// `server/src/server.ts` imports the pair to fingerprint its own roster
// projection, and without the emit the built server dies at startup on a
// module it cannot resolve. Those two files are explicitly `.mjs` rather than
// `.ts` (see `shared/mark.mjs`'s header: `deploy/deploy.sh` runs them under a
// bare `node`, no build step), which is exactly why the CommonJS trap above
// applies to them too and why they belong in COMPILED_ROOTS' coverage.
//
// NOTE: `server/tsconfig.json` is read back by JSON.parse below, so it must
// stay strict JSON — tsc would accept comments in it, this test would not.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, '..');
const repoRoot = path.resolve(serverRoot, '..');

/** Absolute paths of every `.mjs` module imported by a `.ts` file under `dir`,
 *  resolved against the importing file. Derived rather than listed so a `.mjs`
 *  import added tomorrow is covered without anyone remembering to add it. */
function mjsImportsUnder(dir: string): string[] {
  const found = new Set<string>();
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const p = path.join(d, name);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      if (!p.endsWith('.ts')) continue;
      for (const m of readFileSync(p, 'utf8').matchAll(/from\s+'([^']+\.mjs)'/g)) {
        found.add(path.resolve(path.dirname(p), m[1]!));
      }
    }
  };
  walk(dir);
  return [...found].sort();
}

/** The package.json tsc would consult for a source file, i.e. the nearest one
 *  at or above its directory. Returns null if the walk reaches the filesystem
 *  root without finding one — which is exactly the failure this test guards. */
function governingPackageJson(dir: string): { path: string; type?: string } | null {
  let cur = path.resolve(dir);
  for (;;) {
    const candidate = path.join(cur, 'package.json');
    if (existsSync(candidate)) {
      const parsed = JSON.parse(readFileSync(candidate, 'utf8')) as { type?: string };
      return { path: candidate, type: parsed.type };
    }
    const parent = path.dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
}

// Every path in the server tsconfig's `include`, as a directory.
const COMPILED_ROOTS = [
  path.join(serverRoot, 'src'),
  path.resolve(serverRoot, '..', 'shared'),
];

describe('emitted module format', () => {
  it.each(COMPILED_ROOTS)('%s is governed by an ESM package.json', (root) => {
    const pkg = governingPackageJson(root);
    expect(pkg, `no package.json governs ${root} — tsc will emit CommonJS`).not.toBeNull();
    expect(pkg!.type, `${pkg!.path} must declare "type": "module"`).toBe('module');
  });

  it('the tsconfig include list is the one this test checks', () => {
    const tsconfig = JSON.parse(
      readFileSync(path.join(serverRoot, 'tsconfig.json'), 'utf8'),
    ) as { include: string[] };
    // Guards the test itself: a new include entry must be added to COMPILED_ROOTS
    // or it goes unchecked and can reintroduce the CommonJS emit.
    //
    // Deduplicated, because one root can legitimately appear twice — `shared/`
    // is included once for its `.ts` and once for its `.mjs`. The EXTENSION is
    // not what this test is about; the DIRECTORY is, since a package.json
    // governs a directory and every file under it. That dedup is exactly why
    // this assertion CANNOT see the `.mjs` glob going missing, and why the
    // emit test below exists rather than a second structural assertion here.
    const roots = [...new Set(tsconfig.include
      .map((glob) => glob.replace(/\/\*\*\/\*\.(ts|mjs)$/, ''))
      .map((rel) => path.resolve(serverRoot, rel)))].sort();
    expect(roots).toEqual([...COMPILED_ROOTS].sort());
  });

  // Every `shared/*.mjs` this package IMPORTS must actually be EMITTED, proven
  // by running the real compiler and looking at the files on disk.
  //
  // Nothing else can see this break, which is the entire point. The imports
  // resolve at type level through the hand-written `.d.mts` siblings, so `tsc
  // --noEmit` stays clean; vitest transpiles sources directly and never reads
  // `dist/`; `npm run build` exits 0. Delete `"../shared/**/*.mjs"` from the
  // include list — or `"allowJs"` — and every one of those stays green while
  // `dist/shared/` silently loses the files. The built server then throws
  // ERR_MODULE_NOT_FOUND at startup, and `ccrc.service` is `Restart=always`
  // `RestartSec=3` with no StartLimit, so that is a crash loop on the live box
  // with `dist/` already replaced.
  //
  // The `.mjs` list is DERIVED from the imports rather than hardcoded, so a
  // future `.mjs` import is covered the day it is written. The set being empty
  // is a legitimate state (no such imports) and asserts nothing — the guard is
  // "whatever you import, you emit", not "you must import these".
  it('every shared/*.mjs imported by src/ is present in a real emit', () => {
    const imported = mjsImportsUnder(path.join(serverRoot, 'src'));
    const outDir = mkTmp('ccrc-emit-');
    const r = spawnSync(
      process.execPath,
      [path.join(serverRoot, 'node_modules', 'typescript', 'bin', 'tsc'), '--outDir', outDir],
      { cwd: serverRoot, encoding: 'utf8' },
    );
    expect(r.stdout + r.stderr, 'the real build does not compile').toBe('');
    for (const abs of imported) {
      // rootDir is `..` (the repo root), so an input at <repo>/shared/x.mjs
      // emits to <outDir>/shared/x.mjs.
      const emitted = path.join(outDir, path.relative(repoRoot, abs));
      expect(existsSync(emitted), `${path.relative(repoRoot, abs)} is imported by server/src but `
        + 'not emitted — check "allowJs" and the "../shared/**/*.mjs" include in '
        + 'server/tsconfig.json; the built server dies at startup without it').toBe(true);
    }
  }, 180_000);
});
