// ARCH-03 (#541, D-6003), folded into the ring rules by ARCH-04 stage 2 (#545, D-6045, Task C0n).
// RING RULE: no file below L4 imports `server.ts` or `watch.ts`, not even for a type. The ports a consumer needs
// from those hosts are declared beside the consumer (`coord/ports.ts`, L2), so an inner-ring file's import block
// reads inward only. Every import shape counts, a type-only one included: a type import is no runtime edge, but it
// is still a dependency on the host's declaration, which is what ARCH-03 removed.
//
// "Below L4" is the ring `ring.ts` decides by ARCH-02a's rules, the same classifier `outward-edges.test.ts` uses,
// so the allowed importers are not a hand list: an importer is allowed exactly when its own facts or its header put
// it in L4 or L5. The debt allowed by name is `host-imports.data.ts`, empty since ARCH-03 drove it to 0.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseFile, parseSource } from '../scan/parse.js';
import { HOST_IMPORT_EXEMPTIONS } from './host-imports.data.js';
import { malformedEntries } from './exemptions.js';
import { codeOnly, resolveLocal, serverRing } from './ring.js';
import { REPO, walkSrc } from './walkSrc.js';

const HOSTS: ReadonlySet<string> = new Set(['server/src/server.ts', 'server/src/watch.ts']);
const exists = (r: string): boolean => existsSync(path.join(REPO, r));

/** The edges, in any form, by which a file names a host. */
const hostEdges = (file: string, src = parseFile(path.join(REPO, file))): string[] =>
  src.imports.filter((e) => HOSTS.has(resolveLocal(file, e.specifier, exists) ?? ''))
    .map((e) => `:${e.line} ${e.specifier}${e.typeOnly ? ' (type)' : ''}`);

const files = (): string[] => walkSrc({ roots: ['server/src'], min: 170 }).filter((f) => !HOSTS.has(f));

describe('the scan itself (CONTROL)', () => {
  it('sees every import shape, type-only ones included, from any depth, with or without the extension', () => {
    const at = 'server/src/coord/close.ts';
    for (const src of [
      "import type { Deps } from '../server.js';",
      "import { type FleetWatcher } from '../watch.js';",
      "import {\n  a,\n  type B,\n} from '../watch';",
      "export type { C } from '../server.js';",
      "import '../watch.js';",
      "type E = typeof import('../server.js');",
      "let w: import('../watch.js').FleetWatcher;",
    ]) expect(hostEdges(at, parseSource(src)), src).toHaveLength(1);
    for (const src of [
      "// import type { F } from '../server.js';",
      "/** import type { G } from '../watch.js'; */",
      "import { x } from './server.js';",
      "const s = '../server.js';",
    ]) expect(hostEdges(at, parseSource(src)), src).toEqual([]);
  });

  it('finds the hosts\' known L4 importers — a scan that finds nothing would pass the rule below', () => {
    const importers = files().filter((f) => hostEdges(f).length > 0);
    expect(importers).toEqual(expect.arrayContaining(['server/src/coord/routes.ts', 'server/src/index.ts',
      'server/src/sessionws.ts']));
  });

  it('every exemption has a reason and a date', () => {
    expect(malformedEntries(HOST_IMPORT_EXEMPTIONS)).toEqual([]);
  });
});

describe('Deps lives in a type-only deps.ts, and server.ts re-exports it (ARCH-03, D-6003)', () => {
  it('deps.ts declares Deps and CollectLaneDeps, and is L2: every top-level statement in it is a type', () => {
    const src = readFileSync(path.join(REPO, 'server/src/deps.ts'), 'utf8');
    expect(src).toMatch(/^export interface Deps \{/m);
    expect(src).toMatch(/^export interface CollectLaneDeps \{/m);
    expect(serverRing('server/src/deps.ts').ring).toBe('L2');
  });

  it('server.ts declares neither and re-exports both from deps.ts, so no caller breaks', () => {
    const c = codeOnly(readFileSync(path.join(REPO, 'server/src/server.ts'), 'utf8'));
    expect(c).not.toMatch(/\binterface (?:Deps|CollectLaneDeps)\b/);
    expect(c).toMatch(/^export type \{ CollectLaneDeps, Deps \} from '\.\/deps\.js';$/m);
  });
});

describe('no file below L4 imports server.ts or watch.ts, even for a type (D-6003, D-6045)', () => {
  it('every importer is L4 or L5 by the ring rules, and the exemptions are exactly the rest', () => {
    const below = new Map<string, string>();
    for (const f of files()) {
      const edges = hostEdges(f);
      if (edges.length === 0) continue;
      const v = serverRing(f);
      if (v.ring !== 'L4' && v.ring !== 'L5') below.set(f, `${v.ring} (${v.why}) ${edges.join('; ')}`);
    }
    const allowed = new Set(Object.keys(HOST_IMPORT_EXEMPTIONS));
    expect([...below].filter(([f]) => !allowed.has(f)).map(([f, w]) => `${f} ${w}`),
      'a file below L4 imports a host: declare the port beside the consumer (coord/ports.ts), as ARCH-03 did')
      .toEqual([]);
    expect([...allowed].filter((f) => !below.has(f)), 'an exemption no longer occurs: delete it').toEqual([]);
  });
});
