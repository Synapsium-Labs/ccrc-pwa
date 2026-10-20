// D-6045 (plan docs/superpowers/plans/2026-10-19-consolidation-w0-pins.md, Task C0l; ARCH-04 (#545), stage 1).
// RING RULE: no Node builtin in a `.mjs` file the PWA's bundle reaches, and no builtin beyond ARCH-02a's carve-out
// in any `shared/*.mjs` file. The carve-out (the 08-10 spec, L0) lets a `shared/*.mjs` file "which the PWA never
// imports" use `node:crypto`, `node:fs` and `node:url`; this rule is the check behind "never imports".
//
// REACHABLE is decided the way the PWA's bundler resolves, not the way `tsc` does: Vite tries an extension-less
// specifier as `.mjs` before `.ts`, so `../../../shared/models` bundles `shared/models.mjs` while `tsc` reads
// `shared/models.ts` (the twins `pwa/vite.config.ts` warns about). The walk starts at every `pwa/src` source file and
// follows every runtime edge (a type-only edge is erased and bundles nothing) through relative specifiers and the
// `@/` and `@ccrc/ui` doors into `ui/src`. Bare packages are not followed.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';
import { parseFile, parseSource, type ParsedFile } from '../scan/parse.js';
import { MJS_CARVE_OUT, REACHABLE_MJS_EXEMPTIONS } from './mjs-node.data.js';
import { malformedEntries } from './exemptions.js';
import { resolveVite } from './resolveVite.js';
import { REPO, SOURCE_RE, rel, walkSrc } from './walkSrc.js';

const BUILTINS = new Set(builtinModules);
/** A Node builtin specifier, `node:`-prefixed or bare. */
const isBuiltin = (spec: string): boolean => spec.startsWith('node:') || BUILTINS.has(spec);
/** Each builtin a file imports, by its specifier as written. */
const builtinEdges = (p: ParsedFile): { specifier: string; line: number }[] =>
  p.imports.filter((e) => isBuiltin(e.specifier)).map(({ specifier, line }) => ({ specifier, line }));

interface Reach { files: Set<string>; unresolved: string[] }

/** Every repo-relative file the PWA's bundle reaches from `pwa/src`. */
function reachFromPwa(): Reach {
  const files = new Set<string>();
  const unresolved: string[] = [];
  const queue = walkSrc({ roots: ['pwa/src'], min: 180 }).map((f) => path.join(REPO, f));
  while (queue.length > 0) {
    const abs = queue.pop()!;
    const r = rel(abs);
    if (files.has(r)) continue;
    files.add(r);
    if (!SOURCE_RE.test(abs) && !/\.[cm]?jsx?$/.test(abs)) continue;
    for (const e of parseFile(abs).imports) {
      if (e.typeOnly) continue;
      const to = resolveVite(abs, e.specifier);
      if (to === null) unresolved.push(`${r}:${e.line} '${e.specifier}'`);
      else if (to !== 'external' && !files.has(rel(to))) queue.push(to);
    }
  }
  return { files, unresolved };
}

/** The `node:*` modules the 08-10 spec's carve-out sentence names, in its order. */
function specCarveOut(): string[] {
  const spec = readFileSync(path.join(REPO, 'docs/superpowers/specs/2026-08-10-architecture-ddd-clean-solid.md'), 'utf8');
  const m = /The `\.mjs` carve-out:([\s\S]*?)and no other `node:\*` module/.exec(spec);
  if (!m) throw new Error("the 08-10 spec's `.mjs` carve-out sentence is gone");
  return [...m[1]!.matchAll(/`(node:[a-z_/]+)`/g)].map((x) => x[1]!);
}

describe('no Node builtin reaches the PWA through a .mjs file (ARCH-04 stage 1, D-6045)', () => {
  it('CONTROL: an extension-less specifier resolves .mjs first, as Vite does; a .js one finds its .ts', () => {
    const from = path.join(REPO, 'pwa/src/screens/FleetScreen.tsx');
    expect(resolveVite(from, '../../../shared/models')).toBe(path.join(REPO, 'shared/models.mjs'));
    expect(resolveVite(from, '../../../shared/api')).toBe(path.join(REPO, 'shared/api.ts'));
    expect(resolveVite(path.join(REPO, 'shared/roster.ts'), './providers.js')).toBe(path.join(REPO, 'shared/providers.ts'));
    expect(resolveVite(from, 'react')).toBe('external');
    expect(resolveVite(from, './no-such-file')).toBeNull();
  });

  it('CONTROL: a builtin is seen in every form, prefixed or bare, and nothing else is', () => {
    for (const src of ["import fs from 'node:fs';", "import { join } from 'path';", "export * from 'node:os';",
      "const c = await import('node:crypto');"]) expect(builtinEdges(parseSource(src, 'x.mjs')), src).toHaveLength(1);
    for (const src of ["import { a } from './api.js';", "import x from 'react';", "// import fs from 'node:fs';"]) {
      expect(builtinEdges(parseSource(src, 'x.mjs')), src).toEqual([]);
    }
  });

  it('the walk reaches the shared twins the PWA bundles, and every relative specifier resolves', () => {
    const { files, unresolved } = reachFromPwa();
    const mjs = [...files].filter((f) => f.endsWith('.mjs'));
    expect(mjs).toEqual(expect.arrayContaining(['shared/models.mjs', 'shared/base-url.mjs']));
    expect(files).toContain('shared/api.ts');
    expect(unresolved, 'a pwa import the resolver cannot follow hides what it reaches').toEqual([]);
  });

  it('the carve-out data is the spec sentence, and every entry has a reason and a date', () => {
    expect(Object.keys(MJS_CARVE_OUT)).toEqual(specCarveOut());
    expect(malformedEntries(MJS_CARVE_OUT)).toEqual([]);
    expect(malformedEntries(REACHABLE_MJS_EXEMPTIONS)).toEqual([]);
  });

  it('a .mjs file the PWA reaches imports no Node builtin, and no exemption is stale', () => {
    const found = new Set<string>();
    const refused: string[] = [];
    for (const f of [...reachFromPwa().files].filter((x) => x.endsWith('.mjs')).sort()) {
      for (const e of builtinEdges(parseFile(path.join(REPO, f)))) {
        const key = `${f} -> ${e.specifier}`;
        found.add(key);
        if (!(key in REACHABLE_MJS_EXEMPTIONS)) refused.push(`${f}:${e.line} imports '${e.specifier}'`);
      }
    }
    expect(refused, 'the PWA bundles this file: the carve-out covers only files it never imports').toEqual([]);
    expect(Object.keys(REACHABLE_MJS_EXEMPTIONS).filter((k) => !found.has(k)), 'a stale exemption: delete it')
      .toEqual([]);
  });

  it('a shared/*.mjs file imports no builtin beyond the carve-out', () => {
    const refused: string[] = [];
    for (const f of walkSrc({ roots: ['shared'], flat: true, min: 8, match: /\.mjs$/ })) {
      for (const e of builtinEdges(parseFile(path.join(REPO, f)))) {
        if (!(e.specifier in MJS_CARVE_OUT)) refused.push(`${f}:${e.line} imports '${e.specifier}'`);
      }
    }
    expect(refused, "beyond ARCH-02a's .mjs carve-out (node:crypto, node:fs, node:url)").toEqual([]);
  });
});
