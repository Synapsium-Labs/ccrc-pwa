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
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..', '..');
const read = (...seg: string[]): string => readFileSync(path.join(ROOT, ...seg), 'utf8');

/** tsconfig.json is JSONC — comments are legal there and this repo uses them,
 *  so `JSON.parse` on the raw text throws. Measured: adding one `//` line to
 *  `ui/tsconfig.json` made this file's second test fail on a parse rather than
 *  on a claim, which is a guard reporting the wrong thing. Line comments only,
 *  which is all tsconfig here carries; a `/* *\/` block would need more. */
const readJsonc = <T,>(...seg: string[]): T =>
  JSON.parse(read(...seg).replace(/^\s*\/\/.*$/gm, '')) as T;

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

  it('nothing in the tree imports `@/` yet, so the alias is plumbing and not a dependency', () => {
    // HONEST SCOPE. No ccrc file uses this prefix today; it exists for files
    // the CLI will write. If that changes, this assertion is the place to
    // notice — an alias with real consumers deserves a stronger guard than a
    // text match on two configs.
    const walk = (dir: string): string[] => {
      const out: string[] = [];
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) out.push(...walk(p));
        else if (/\.tsx?$/.test(e.name)) out.push(p);
      }
      return out;
    };
    const users = [...walk(path.join(ROOT, 'ui', 'src')), ...walk(path.join(ROOT, 'pwa', 'src'))]
      // BOTH IMPORT FORMS. `from '@/…'` and a bare side-effect `import
      // '@/…'` — measured: with only the first, adding `import '@/lib/cn'`
      // to a file left all three green.
      .filter((f) => /(?:from|import)\s+'@\//.test(readFileSync(f, 'utf8')))
      .map((f) => path.relative(ROOT, f));
    expect(users).toEqual([]);
  });
});
