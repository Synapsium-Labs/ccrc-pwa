// D-6045 (plan docs/superpowers/plans/2026-10-19-consolidation-w0-pins.md, Task C0k; ARCH-04 (#545), stage 1).
// RING RULE: a `shared/*.ts` file imports only its `./` siblings. L0 "imports nothing, not even `node:*`" (the 08-10
// spec): the PWA bundles every one of these files, so a `node:*` or a package import breaks the client build, and
// a `../` import points L0 at an outer ring. Every edge counts, a type-only one included: an L0 type that names a
// server type has stopped being the ubiquitous language. This one rule replaces the per-file "is L0, imports
// nothing" pins (D-6045 lists the ones it retired). The `.mjs` side is `mjs-node.test.ts`.
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
});
