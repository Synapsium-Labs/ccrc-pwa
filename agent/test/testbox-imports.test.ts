// D-7406 (plan docs/superpowers/plans/2026-10-29-test-box.md, Task TB4; §Review focus 4). The import census: the
// fleet agent's entry point (`agent/src/index.ts`) reaches none of the test service's systemd, mirror or spec
// adapters, and nothing under `agent/src/testbox/` reaches the fleet agent's exec whitelist (`agent/src/whitelist.ts`).
// The walker follows every static `import`/`export … from` and every literal `import('…')`, type-only ones included
// (an edge in the source is an edge, whatever the emit drops). It also counts the package's entry points: the files
// under `agent/src` that no other file there imports (1 at the base, `index.ts`; 2 with the test service's `main.ts`).
import { describe, it, expect } from 'vitest';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

const IMPORT = /(?:^|[\s;])(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]|(?:^|[\s;])import\s*['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;

/** The relative imports of one file, resolved to files (`.js` names its `.ts` source). */
export function importsOf(file: string): string[] {
  const out: string[] = [];
  for (const m of readFileSync(file, 'utf8').matchAll(IMPORT)) {
    const spec = m[1] ?? m[2] ?? m[3];
    if (spec === undefined || !spec.startsWith('.')) continue;
    const abs = path.resolve(path.dirname(file), spec);
    const cands = [abs.replace(/\.js$/, '.ts'), abs.replace(/\.mjs$/, '.mts'), abs, `${abs}.ts`, path.join(abs, 'index.ts')];
    const hit = cands.find((c) => existsSync(c) && statSync(c).isFile());
    if (hit !== undefined) out.push(hit);
  }
  return out;
}

/** Every file `entry` reaches, itself included. */
export function reach(entry: string): Set<string> {
  const seen = new Set<string>();
  const todo = [entry];
  while (todo.length > 0) {
    const f = todo.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    todo.push(...importsOf(f));
  }
  return seen;
}

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const n of readdirSync(dir)) {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) out.push(...tsFiles(p));
    else if (n.endsWith('.ts')) out.push(p);
  }
  return out.sort();
}

/** The files under `dir` that no other file there imports. */
export function entryPoints(dir: string): string[] {
  const files = tsFiles(dir);
  const imported = new Set(files.flatMap((f) => importsOf(f)));
  return files.filter((f) => !imported.has(f)).map((f) => path.relative(dir, f).split(path.sep).join('/'));
}

const FENCED = ['systemd.ts', 'mirror.ts', 'spec.ts'].map((f) => path.join(SRC, 'testbox', f));

describe('the fleet agent never loads the test service\'s adapters (§Review focus 4)', () => {
  it('nothing agent/src/index.ts imports reaches agent/src/testbox/systemd.ts, mirror.ts or spec.ts', () => {
    const r = reach(path.join(SRC, 'index.ts'));
    expect(r.has(path.join(SRC, 'server.ts')), 'the walker reaches the agent\'s server').toBe(true);
    expect(r.has(path.join(SRC, 'whitelist.ts')), 'and its whitelist').toBe(true);
    expect(FENCED.filter((f) => r.has(f)).map((f) => path.relative(SRC, f))).toEqual([]);
  });
  it('nothing under agent/src/testbox imports agent/src/whitelist.ts', () => {
    const wl = path.join(SRC, 'whitelist.ts');
    const offenders = tsFiles(path.join(SRC, 'testbox')).filter((f) => reach(f).has(wl)).map((f) => path.relative(SRC, f));
    expect(offenders).toEqual([]);
    expect(reach(path.join(SRC, 'testbox', 'main.ts')).has(path.join(SRC, 'testbox', 'systemd.ts')), 'the walker reaches main.ts\'s adapters').toBe(true);
  });
  it('the package has two entry points: the fleet agent and the test service', () => {
    expect(entryPoints(SRC)).toEqual(['index.ts', 'testbox/main.ts']);
  });
});

describe('the census reds the edges it guards (mutations, in a fixture tree)', () => {
  const tree = (files: Record<string, string>): string => {
    const root = mkTmp('ccrc-tb-imports-');
    for (const [f, body] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
      writeFileSync(path.join(root, f), body);
    }
    return root;
  };
  it('an index that reaches systemd.ts through another file is seen, a type-only and a dynamic import too', () => {
    for (const edge of ["import { units } from './testbox/systemd.js';", "import type { Exec } from './testbox/systemd.js';",
      "export { units } from './testbox/systemd.js';", "const m = await import('./testbox/systemd.js');"]) {
      const root = tree({ 'index.ts': "import { x } from './server.js';\n", 'server.ts': `${edge}\nexport const x = 1;\n`, 'testbox/systemd.ts': 'export const units = 1;\n' });
      expect(reach(path.join(root, 'index.ts')).has(path.join(root, 'testbox', 'systemd.ts')), edge).toBe(true);
    }
  });
  it('a test service file that imports the whitelist is seen', () => {
    const root = tree({ 'testbox/service.ts': "import { isExecAllowed } from '../whitelist.js';\n", 'whitelist.ts': 'export const isExecAllowed = 1;\n' });
    expect(reach(path.join(root, 'testbox', 'service.ts')).has(path.join(root, 'whitelist.ts'))).toBe(true);
  });
  it('a third entry point is counted', () => {
    const root = tree({ 'index.ts': "import './a.js';\n", 'a.ts': '', 'other.ts': '' });
    expect(entryPoints(root)).toEqual(['index.ts', 'other.ts']);
  });
});
