// The `@/…` alias means one thing in three places, and this is what says so.
//
// WHY IT EXISTS. `ui/components.json` is shadcn's CLI contract: it tells
// `npx shadcn add` where a component goes and what import prefix to write.
// Every file the CLI writes imports through `@/…`, so three resolvers have to
// agree about that prefix or the pasted file resolves in some of them and not
// others:
//
//   1. `ui/tsconfig.json`'s `paths` — what `tsc` reads.
//   2. `ui/vite.config.ts`'s alias — what Storybook builds with.
//   3. `pwa/vite.config.ts`'s alias — what the APP builds with, because pwa
//      compiles `@ccrc/ui`'s source directly (`exports['.']` is
//      `src/index.ts`) rather than a dist.
//
// THIS BRANCH ALREADY PAID FOR THAT LESSON ONCE. `shared/models` is three
// files; an extension-less import resolves to the `.mjs` in the bundle and the
// `.ts` in `tsc`, so a derived export added to the `.ts` alone type-checked
// clean in both packages and was `undefined` at runtime — five tests died on a
// render and nothing else could see it. `server/test/models.test.ts` guards
// that seam; this guards this one, before anybody pastes a component.
//
// WHAT IT DOES NOT CLAIM. That a pasted shadcn component RENDERS correctly:
// that needs the token alias layer, which `theme-bridge.test.ts` still
// refuses on the design system's own standing ruling. This is the mechanical
// half — the file lands in the right directory with imports that resolve.
import { describe, expect, it } from 'vitest';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ROOT = path.join(import.meta.dirname, '..', '..');
const read = (...seg: string[]): string => readFileSync(path.join(ROOT, ...seg), 'utf8');

/** tsconfig.json is JSONC — comments are legal there and this repo uses them,
 *  so `JSON.parse` on the raw text throws. Measured: adding one `//` line to
 *  `ui/tsconfig.json` made this file's second test fail on a parse rather than
 *  on a claim, which is a guard reporting the wrong thing. Line comments only,
 *  which is all tsconfig here carries; a `/* *\/` block would need more. */
const readJsonc = <T,>(...seg: string[]): T =>
  JSON.parse(read(...seg).replace(/^\s*\/\/.*$/gm, '')) as T;

function aliasUsers(root: string): string[] {
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : /\.tsx?$/.test(e.name) ? [p] : [];
  });
  return [...walk(path.join(root, 'ui', 'src')), ...walk(path.join(root, 'pwa', 'src'))]
    .filter((f) => /(?:(?:from|import)\s+|import\s*\(\s*)['"]@\//.test(readFileSync(f, 'utf8')))
    .map((f) => path.relative(root, f));
}

describe('the shadcn `@/` alias resolves the same way everywhere', () => {
  it('ui/components.json points at directories that exist', () => {
    const cfg = readJsonc<{ tailwind: { css: string }; aliases: Record<string, string> }>(
      'ui', 'components.json');
    // The stylesheet the CLI would extend is the real one.
    expect(read('ui', cfg.tailwind.css).length).toBeGreaterThan(0);
    // Every alias target resolves under ui/src — `utils` names a MODULE
    // (`lib/cn`), the rest name directories, so both shapes are tried.
    for (const [name, spec] of Object.entries(cfg.aliases)) {
      expect(spec, name).toMatch(/^@\//);
      const base = path.join(ROOT, 'ui', 'src', spec.replace(/^@\//, ''));
      const found = ['', '.ts', '.tsx', '/index.ts'].some((ext) => existsSync(base + ext));
      expect(found, `${name} -> ${spec} resolves to nothing under ui/src`).toBe(true);
    }
  });

  it('tsconfig, ui vite and pwa vite all map `@/` to ui/src', () => {
    const ts = readJsonc<{ compilerOptions: { paths?: Record<string, string[]> } }>(
      'ui', 'tsconfig.json');
    expect(ts.compilerOptions.paths?.['@/*']).toEqual(['./src/*']);
    // The two vite configs are read as TEXT: they are modules with imports
    // this test has no business executing, and the alias is a literal in both.
    expect(read('ui', 'vite.config.ts'))
      .toMatch(/alias:\s*\{\s*'@':\s*fileURLToPath\(new URL\('\.\/src', import\.meta\.url\)\)/);
    expect(read('pwa', 'vite.config.ts'))
      .toMatch(/'@':\s*fileURLToPath\(new URL\('\.\.\/ui\/src', import\.meta\.url\)\)/);
  });

  it('only the reader assets import the alias, including dynamic imports', () => {
    expect(aliasUsers(ROOT)).toEqual(['pwa/src/docs/reader/assets.ts']);
    const copy = mkdtempSync(path.join(os.tmpdir(), 'alias-scan-'));
    try {
      cpSync(path.join(ROOT, 'ui', 'src'), path.join(copy, 'ui', 'src'), { recursive: true });
      cpSync(path.join(ROOT, 'pwa', 'src'), path.join(copy, 'pwa', 'src'), { recursive: true });
      const planted = path.join(copy, 'pwa', 'src', 'alias-control.ts');
      for (const source of ["import x from '@/lib/cn';", "const x = import('@/fonts/x.woff2?inline');", 'import x from "@/lib/cn";']) {
        writeFileSync(planted, source);
        expect(aliasUsers(copy)).toEqual(['pwa/src/alias-control.ts', 'pwa/src/docs/reader/assets.ts']);
      }
    } finally { rmSync(copy, { recursive: true, force: true }); }
  });
});
