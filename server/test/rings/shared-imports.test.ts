// D-6045 (plan docs/superpowers/plans/2026-10-19-consolidation-w0-pins.md, Task C0l; ARCH-04 (#545), stage 1).
// RING RULE: a `shared/*.ts` file imports only its `./` siblings. L0 "imports nothing, not even `node:*`" (the 08-10
// spec): the PWA bundles every one of these files, so a `node:*` or a package import breaks the client build, and
// a `../` import points L0 at an outer ring. Every edge counts, a type-only one included: an L0 type that names a
// server type has stopped being the ubiquitous language. This one rule replaces the per-file "is L0, imports
// nothing" pins (D-6045 lists the ones it retired). The `.mjs` side is `mjs-node.test.ts`.
//
// scan/parse.ts reports no edge for a `require(…)` call, nor for an `import(…)` whose argument is not a literal
// (its KNOWN WIDTH), and the retired pins refused both; so this rule also refuses either call anywhere in a
// `shared/*.ts` file's comment-stripped text. A match inside a string is red, never silent: reword the string.
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { parseFile, parseSource, type ParsedFile } from '../scan/parse.js';
import { SHARED_IMPORT_EXEMPTIONS } from './shared-imports.data.js';
import { malformedEntries } from './exemptions.js';
import { REPO, walkSrc } from './walkSrc.js';

const SIBLING = /^\.\/[^/]+$/;

/** Each edge that names something other than a `./` sibling, as `<specifier>` with its line. */
const outsideEdges = (p: ParsedFile): { specifier: string; line: number }[] =>
  p.imports.filter((e) => !SIBLING.test(e.specifier)).map(({ specifier, line }) => ({ specifier, line }));

const UNSEEN_CALL = /\brequire\s*\(|\bimport\s*\((?!\s*(?:'|"|`[^`$]*`))/g;

/** `require(` and a non-literal `import(`, the calls no edge reports, after `//` and block comments are removed. */
const unseenCalls = (text: string): { call: string; line: number }[] => {
  const lines = text.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' ')).split('\n');
  const out: { call: string; line: number }[] = [];
  lines.forEach((l, i) => {
    const code = l.replace(/\/\/.*$/, '');
    for (const m of code.matchAll(UNSEEN_CALL)) out.push({ call: m[0].trim(), line: i + 1 });
  });
  return out;
};

const files = (): string[] => walkSrc({ roots: ['shared'], flat: true, min: 25, match: /\.ts$/ });

describe('shared/*.ts imports only ./ siblings (ARCH-04 stage 1, D-6045)', () => {
  it('CONTROL: every edge kind is seen, and a sibling is the one thing allowed', () => {
    const refused = [
      "import fs from 'node:fs';",
      "import type { Stats } from 'node:fs';",
      "import { z } from 'zod';",
      "import type { Deps } from '../server/src/deps.js';",
      "export { X } from '../pwa/src/lib/api.js';",
      "export * from 'node:path';",
      "const m = await import('node:crypto');",
      "import fs = require('fs');",
      "type T = import('node:fs').Stats;",
      "const m = await import( 'node:crypto');",
      "const m = await import(`node:crypto`);",
      "import { x } from './sub/x.js';",
      "import { y } from 'shared/api.js';",
    ];
    for (const src of refused) expect(outsideEdges(parseSource(src)), src).toHaveLength(1);
    const allowed = [
      "import { A } from './api.js';",
      "import type { B } from './agent-protocol.js';",
      "export { C } from './models.mjs';",
      "// import fs from 'node:fs';",
    ];
    for (const src of allowed) expect(outsideEdges(parseSource(src)), src).toEqual([]);
  });

  it('CONTROL: a require call and a non-literal import() are refused, a literal import() is left to the edges', () => {
    const refused = [
      "const fs = require('node:fs');",
      "const fs = require ('node:fs');",
      "const m = await import(name);",
      "const m = await import( `node:${x}`);",
      "export const load = () => import(spec);",
    ];
    for (const src of refused) expect(unseenCalls(src), src).toHaveLength(1);
    const allowed = [
      "const m = await import('node:crypto');",
      "type T = import('node:fs').Stats;",
      "const m = await import( 'node:crypto');",
      "const m = await import(`node:crypto`);",
      "// const fs = require('node:fs');",
      "/* import(name) */ const x = 1;",
      "/**\n * require(x)\n */",
      "const requireAll = 1;",
    ];
    for (const src of allowed) expect(unseenCalls(src), src).toEqual([]);
    expect(unseenCalls("const a = 1;\n/* x\n y */ const fs = require('fs');")).toEqual([{ call: 'require(', line: 3 }]);
  });

  it('the walk covers the L0 kernel files, and only shared/ top-level .ts files', () => {
    const f = files();
    expect(f).toEqual(expect.arrayContaining(['shared/api.ts', 'shared/lifecycle.ts', 'shared/ask-menu.ts']));
    expect(f.every((x) => /^shared\/[^/]+\.ts$/.test(x))).toBe(true);
  });

  it('every exemption has a reason and a date', () => {
    expect(malformedEntries(SHARED_IMPORT_EXEMPTIONS)).toEqual([]);
  });

  it('no shared/*.ts file imports anything but a ./ sibling, and no exemption is stale', () => {
    const found = new Set<string>();
    const refused: string[] = [];
    for (const f of files()) {
      for (const e of outsideEdges(parseFile(path.join(REPO, f)))) {
        const key = `${f} -> ${e.specifier}`;
        found.add(key);
        if (!(key in SHARED_IMPORT_EXEMPTIONS)) refused.push(`${f}:${e.line} imports '${e.specifier}'`);
      }
    }
    expect(refused, 'L0 imports only its ./ siblings: the PWA bundles this file').toEqual([]);
    expect(Object.keys(SHARED_IMPORT_EXEMPTIONS).filter((k) => !found.has(k)), 'a stale exemption: delete it')
      .toEqual([]);
  });

  it('no shared/*.ts file calls require() or a non-literal import(), the loads no edge reports', () => {
    const refused: string[] = [];
    for (const f of files()) {
      for (const c of unseenCalls(parseFile(path.join(REPO, f)).text)) refused.push(`${f}:${c.line} ${c.call}`);
    }
    expect(refused, 'L0 loads nothing at run time: the PWA bundles this file').toEqual([]);
  });
});
