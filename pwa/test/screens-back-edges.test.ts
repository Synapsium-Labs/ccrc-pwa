// ARCH-05 (#551, D-5897): the feature directories do not import from the screens. A screen composes `fleet/` and
// `session/` modules. An import the other way is a back-edge: a word module that loads a whole screen to borrow
// one helper. Before D-5897 there were six: `humanBytes` came from `screens/ArchiveScreen.tsx`, the settings words
// and the result line from `screens/settingsText.ts`, and `releaseDate` from `screens/updates.tsx`.
//
// Every import counts, including `import type`. A type back-edge is still a dependency of a feature on a screen.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = path.join(import.meta.dirname, '..', 'src');
const rel = (f: string): string => path.relative(SRC, f).split(path.sep).join('/');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? sources(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
}

/** Comments blanked: a docstring may name the screen it says the file no longer imports. */
const codeOnly = (s: string): string => s
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, (m, p: string) => p + ' '.repeat(m.length - p.length));

/** Every specifier one file imports or re-exports, by any of the forms, type imports included. */
function specifiers(src: string): string[] {
  const c = codeOnly(src);
  return [
    ...[...c.matchAll(/^\s*(?:import|export)\s[^'";]*?\bfrom\s*(['"])([^'"]+)\1/gm)].map((m) => m[2]!),
    ...[...c.matchAll(/^\s*import\s*(['"])([^'"]+)\1/gm)].map((m) => m[2]!),
    ...[...c.matchAll(/\bimport\s*\(\s*(['"])([^'"]+)\1/g)].map((m) => m[2]!),
  ];
}

/** `fleet/x.ts imports screens/y` for each import of `dir` that lands under `src/screens/`. */
function backEdges(dir: string): string[] {
  const screens = path.join(SRC, 'screens') + path.sep;
  return sources(path.join(SRC, dir)).flatMap((f) => specifiers(readFileSync(f, 'utf8'))
    .filter((s) => s.startsWith('.') && (path.resolve(path.dirname(f), s) + path.sep).startsWith(screens))
    .map((s) => `${rel(f)} imports ${rel(path.resolve(path.dirname(f), s))}`));
}

describe('the scan itself (CONTROL)', () => {
  it('sees each import form, type imports included, and no commented one', () => {
    expect(specifiers([
      `import { a } from '../screens/A';`,
      `import type { B } from "../screens/B";`,
      `export { c } from '../screens/C';`,
      `import '../screens/d.css';`,
      `const e = lazy(() => import('../screens/E'));`,
      `// import { f } from '../screens/F';`,
      `import {\n  g,\n  type H,\n} from '../screens/GH';`,
    ].join('\n'))).toEqual(['../screens/A', '../screens/B', '../screens/C', '../screens/GH', '../screens/d.css',
      '../screens/E']);
  });

  it('finds the screens importing the features — an empty walk would pass the pins below', () => {
    expect(sources(path.join(SRC, 'fleet')).length).toBeGreaterThan(20);
    expect(sources(path.join(SRC, 'session')).length).toBeGreaterThan(20);
    // `app.tsx` imports screens, so a scan over `src/` root files finds real edges with this same resolver.
    const app = specifiers(readFileSync(path.join(SRC, 'app.tsx'), 'utf8'))
      .filter((s) => s.startsWith('./screens/'));
    expect(app.length).toBeGreaterThan(0);
  });
});

describe('no feature directory imports a screen (D-5897)', () => {
  it('fleet/ → screens/ is empty', () => {
    expect(backEdges('fleet')).toEqual([]);
  });
  it('session/ → screens/ is empty', () => {
    expect(backEdges('session')).toEqual([]);
  });
});

describe('the moved helpers are pure leaves (D-5897)', () => {
  for (const f of ['lib/apiError.ts', 'lib/format.ts']) {
    it(`${f} imports nothing`, () => {
      expect(existsSync(path.join(SRC, f)), `${f} is gone — a moved file must turn this red, not disarm it`).toBe(true);
      expect(specifiers(readFileSync(path.join(SRC, f), 'utf8'))).toEqual([]);
    });
  }

  it('lib/api.ts re-exports the one ApiError class, so an instanceof check holds whichever path imported it', async () => {
    const [fromApi, own] = await Promise.all([import('../src/lib/api'), import(/* @vite-ignore */ `../src/lib/${'apiError'}`) as Promise<{ ApiError: unknown }>]);
    expect(own.ApiError).toBeTypeOf('function');
    expect(fromApi.ApiError).toBe(own.ApiError);
  });
});
