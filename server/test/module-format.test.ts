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
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, '..');

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
    // governs a directory and every file under it.
    const roots = [...new Set(tsconfig.include
      .map((glob) => glob.replace(/\/\*\*\/\*\.(ts|mjs)$/, ''))
      .map((rel) => path.resolve(serverRoot, rel)))].sort();
    expect(roots).toEqual([...COMPILED_ROOTS].sort());
  });
});
