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
    const roots = tsconfig.include
      .map((glob) => glob.replace(/\/\*\*\/\*\.ts$/, ''))
      .map((rel) => path.resolve(serverRoot, rel))
      .sort();
    expect(roots).toEqual([...COMPILED_ROOTS].sort());
  });
});
