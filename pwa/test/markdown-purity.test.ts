// The parse worker's import closure stays pure (native Docs reader, W4 Task 3; design 2026-10-01 section 4.10 and
// the W4 plan's ring rule): starting from the worker-side roots, every file the closure reaches imports only other
// closure files, `unified`, `remark-parse`, `remark-gfm`, `remark-rehype` and the types-only `hast` and `mdast`.
// So no React, no react-dom, no highlight.js, no `../session/*`, no `./api` and no stylesheet can reach the worker.
// Specifiers are read by TypeScript's own `ts.preProcessFile` (static imports, re-exports, `import()` and
// `require`), not by a regex. `hast` and `mdast` have no runtime module (their only package is `@types/*`), so
// naming them can only ever be a type import. ROOTS end at `markdownWorker.ts`, the entry. It reads imports only: a DOM
// global used without an import (`window`, `document`) is not seen here, and the worker, which has no DOM, is
// where such a use would fail.
//
// The five direct dependencies the closure rests on are pinned exactly, in `package.json` and in the lock's root.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const PWA = path.join(import.meta.dirname, '..');
const LIB = path.join(PWA, 'src', 'lib');
const ROOTS: readonly string[] = [
  'markdownLimits.ts', 'markdownGuard.ts', 'remarkAlerts.ts', 'markdownParse.ts', 'markdownWorker.ts',
];
const ALLOWED_PACKAGES: ReadonlySet<string> = new Set([
  'unified', 'remark-parse', 'remark-gfm', 'remark-rehype', 'hast', 'mdast',
]);

/** The file a relative specifier names, or `undefined` when no `.ts`/`.tsx` file answers it. */
function resolveRelative(from: string, spec: string): string | undefined {
  const base = path.resolve(path.dirname(from), spec);
  return [`${base}.ts`, `${base}.tsx`, base, path.join(base, 'index.ts')]
    .find((p) => /\.tsx?$/.test(p) && existsSync(p));
}

/** Walks the closure from ROOTS: the files reached, and every specifier that is neither a closure file nor allowed. */
function closure(): { files: string[]; refused: string[] } {
  const seen = new Set<string>();
  const refused: string[] = [];
  const todo = ROOTS.map((r) => path.join(LIB, r));
  while (todo.length > 0) {
    const file = todo.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const rel = path.relative(PWA, file).split(path.sep).join('/');
    const info = ts.preProcessFile(readFileSync(file, 'utf8'), true, true);
    for (const { fileName: spec } of info.importedFiles) {
      if (spec.startsWith('.')) {
        const target = resolveRelative(file, spec);
        if (target === undefined) refused.push(`${rel}: ${spec}`);
        else todo.push(target);
      } else if (!ALLOWED_PACKAGES.has(spec)) refused.push(`${rel}: ${spec}`);
    }
  }
  return { files: [...seen].map((f) => path.relative(PWA, f).split(path.sep).join('/')).sort(), refused };
}

describe('the parse worker closure', () => {
  const { files, refused } = closure();

  it('is exactly the worker-side lib files', () => {
    expect(files).toEqual(ROOTS.map((r) => `src/lib/${r}`).sort());
  });

  it('imports nothing outside the closure but unified, the three remark plugins and the hast/mdast types', () => {
    expect(refused).toEqual([]);
  });
});

const PINS: Readonly<Record<string, string>> = {
  'hast-util-to-jsx-runtime': '2.3.6',
  'html-url-attributes': '3.0.1',
  'remark-parse': '11.0.0',
  'remark-rehype': '11.1.2',
  unified: '11.0.5',
};

describe('the five direct dependencies are pinned exactly', () => {
  const pkg = JSON.parse(readFileSync(path.join(PWA, 'package.json'), 'utf8')) as {
    dependencies: Record<string, string>;
  };
  const lock = JSON.parse(readFileSync(path.join(PWA, 'package-lock.json'), 'utf8')) as {
    packages: Record<string, { version?: string; dependencies?: Record<string, string> }>;
  };

  it.each(Object.entries(PINS))('%s is %s in package.json, in the lock root, and installed at it', (name, version) => {
    expect(pkg.dependencies[name]).toBe(version);
    expect(lock.packages['']?.dependencies?.[name]).toBe(version);
    expect(lock.packages[`node_modules/${name}`]?.version).toBe(version);
  });
});
