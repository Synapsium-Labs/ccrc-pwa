// ARCH-03 (#541, D-6003): no file below L4 imports `server.ts` or `watch.ts`, not even for a type. The ports a
// consumer needs from those hosts are declared beside the consumer (`coord/ports.ts`, L2), so an inner-ring file's
// import block reads inward only. This walk sees every import shape, type-only ones included: a type import is no
// runtime edge, but it is still a dependency on the host's declaration, which is what ARCH-03 removes.
//
// "Below L4" is decided by the ring rules ARCH-02a wrote (the 08-10 spec, "Deciding a file's ring and context"): a
// file is L4 or L5 when it is `index.ts`, imports `fastify` or an `@fastify/*` package in any form, keeps a
// scheduler's or poller's timer handle on an object field, or declares L4 in its header. The set of files allowed
// to import a host is pinned exactly below, and a CONTROL proves each member is L4 or L5 by one of those facts, so
// the list can neither grow by an inner file nor go stale.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = path.join(ROOT, 'server', 'src');
const relSrc = (f: string): string => path.relative(SRC, f).split(path.sep).join('/');

/** Comments blanked: a docstring may name the very import it says the file does not take. */
const codeOnly = (s: string): string => s
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, (m, p: string) => p + ' '.repeat(m.length - p.length));

/** Every module specifier a source text names, in any form: static import or export (type-only included), a bare
 *  import, a dynamic `import('…')` and a type query `typeof import('…')`. */
function allSpecifiers(src: string): string[] {
  const c = codeOnly(src);
  const out: string[] = [];
  for (const m of c.matchAll(/^\s*(?:import|export)\s[^'";]*?\bfrom\s*(['"])([^'"]+)\1/gm)) out.push(m[2]!);
  for (const m of c.matchAll(/^\s*import\s*(['"])([^'"]+)\1/gm)) out.push(m[2]!);
  for (const m of c.matchAll(/\bimport\s*\(\s*(['"])([^'"]+)\1/g)) out.push(m[2]!);
  return out;
}

/** True when a specifier, resolved from `from`, names one of the two hosts. Extension-less forms count too. */
const HOSTS = ['server.ts', 'watch.ts'].map((f) => path.join(SRC, f));
function namesHost(from: string, spec: string): boolean {
  if (!spec.startsWith('.')) return false;
  const p = path.resolve(path.dirname(from), spec).replace(/\.js$/, '.ts');
  return HOSTS.includes(p) || HOSTS.includes(`${p}.ts`);
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...sourceFiles(p));
    else if (/\.m?ts$/.test(e.name) && !/\.d\.m?ts$/.test(e.name) && !/\.test\.m?ts$/.test(e.name)) out.push(p);
  }
  return out.sort();
}

/** The non-test `server/src` files that import a host in any form. */
function hostImporters(): string[] {
  return sourceFiles(SRC)
    .filter((f) => !HOSTS.includes(f))
    .filter((f) => allSpecifiers(readFileSync(f, 'utf8')).some((s) => namesHost(f, s)))
    .map(relSrc);
}

/** The L4/L5 facts of the ring rules, each read from the file's own text. */
function outerRingFact(f: string): string | null {
  if (relSrc(f) === 'index.ts') return 'L5 (index.ts)';
  const text = readFileSync(f, 'utf8');
  const c = codeOnly(text);
  if (allSpecifiers(text).some((s) => s === 'fastify' || s.startsWith('@fastify/'))) return 'imports fastify';
  // A scheduler or poller: a repeating or rescheduled timer whose handle is kept on an object field.
  if (/\bthis\.\w+\s*=\s*set(?:Interval|Timeout)\s*\(/.test(c)) return 'keeps a timer handle on a field';
  // The header: the lines before the first top-level statement that is not an import.
  const lines = text.split('\n');
  const header: string[] = [];
  for (const line of lines) {
    if (/^\s*(\/\/|\/\*|\*|$)/.test(line) || /^\s*import\b/.test(line) || /^\s+[\w{},\s]*(from\s.*)?;?\s*$/.test(line)
      || /^\s*\}\s*from\s/.test(line)) { header.push(line); continue; }
    break;
  }
  const declared = /(?:^\s*(?:\/\/|\/\*\*?|\*)\s*|: |\. |— |ring |is )L4(?::|,|\.| —| \(| (?:policy|port|ports|adapter|adapters|delivery|composition|decision)\b)/im;
  if (header.some((l) => /^\s*(\/\/|\/\*|\*)/.test(l) && declared.test(l))) return 'declares L4 in its header';
  return null;
}

/** The files ALLOWED to import a host: L4 delivery and the L5 composition root. Exact, and each proven by CONTROL. */
const OUTER_IMPORTERS = [
  'coord/routes.ts', 'hibernateSweep.ts', 'index.ts', 'sessionws.ts', 'stopDoneSweep.ts', 'token/routes.ts',
  'update/routes.ts',
];

/** The ports `server.ts` used to declare for its inner consumers, now in a type-only file of their own (ARCH-03's
 *  second half, extending D-6003): `Deps`, the bag the composition root builds and `buildServer` takes, and
 *  `CollectLaneDeps`, one of its members. `server.ts` re-exports both, so every caller that names them there still
 *  compiles. */
const DEPS = path.join(SRC, 'deps.ts');

/** True when every top-level statement of a source text is a type: `import type`, `export type`, an interface or a
 *  type alias. Such a file emits `export {};` and nothing else, so it is no runtime edge for anyone. */
function typeOnly(src: string): boolean {
  const c = codeOnly(src);
  const tops = c.split('\n').filter((l) => /^\S/.test(l) && !/^\}/.test(l));
  return tops.length > 0 && tops.every((l) =>
    /^import type\s/.test(l) || /^export (?:type|interface)\s/.test(l) || /^(?:type|interface)\s/.test(l));
}

describe('the scan itself (CONTROL)', () => {
  it('sees every import shape, type-only ones included', () => {
    expect(allSpecifiers([
      `import type { Deps } from './server.js';`,
      `import { type FleetWatcher } from "./watch.js";`,
      `import {\n  a,\n  type B,\n} from './ab.js';`,
      `export type { C } from './c.js';`,
      `import './d.js';`,
      `type E = typeof import('./e.js');`,
      `// import type { F } from './f.js';`,
      `/** import type { G } from './g.js'; */`,
    ].join('\n'))).toEqual(['./server.js', './watch.js', './ab.js', './c.js', './d.js', './e.js']);
  });

  it('resolves both hosts from any depth, with or without the extension', () => {
    expect(namesHost(path.join(SRC, 'coord', 'close.ts'), '../server.js')).toBe(true);
    expect(namesHost(path.join(SRC, 'turnverdict.ts'), './watch')).toBe(true);
    expect(namesHost(path.join(SRC, 'coord', 'close.ts'), './server.js')).toBe(false);
  });

  it('finds the hosts\' known L4 importers — a scan that finds nothing would pass the pin below', () => {
    expect(hostImporters()).toEqual(expect.arrayContaining(['coord/routes.ts', 'index.ts', 'sessionws.ts']));
  });

  for (const f of OUTER_IMPORTERS) {
    it(`${f} is L4 or L5 by the ring rules, so it may import a host`, () => {
      expect(outerRingFact(path.join(SRC, f)), `${f} is not L4 or L5 by any ring fact`).not.toBeNull();
    });
  }

  it('reads a type-only file as type-only, and a file with one runtime statement as not', () => {
    expect(typeOnly(`import type { A } from './a.js';\n\nexport interface B {\n  a: A;\n}\nexport type C = B;\n`)).toBe(true);
    expect(typeOnly(`import type { A } from './a.js';\nexport const b = 1;\n`)).toBe(false);
    expect(typeOnly(`import { A } from './a.js';\nexport type C = A;\n`)).toBe(false);
  });
});

describe('Deps lives in a type-only deps.ts, and server.ts re-exports it (ARCH-03, D-6003)', () => {
  it('deps.ts declares Deps and CollectLaneDeps, and every top-level statement in it is a type', () => {
    const src = readFileSync(DEPS, 'utf8');
    expect(src).toMatch(/^export interface Deps \{/m);
    expect(src).toMatch(/^export interface CollectLaneDeps \{/m);
    expect(typeOnly(src)).toBe(true);
  });

  it('server.ts declares neither and re-exports both from deps.ts, so no caller breaks', () => {
    const c = codeOnly(readFileSync(path.join(SRC, 'server.ts'), 'utf8'));
    expect(c).not.toMatch(/\binterface (?:Deps|CollectLaneDeps)\b/);
    expect(c).toMatch(/^export type \{ CollectLaneDeps, Deps \} from '\.\/deps\.js';$/m);
  });
});

describe('no file below L4 imports server.ts or watch.ts, even for a type (D-6003)', () => {
  it('the importers are exactly the L4/L5 files — no inner file, none pending', () => {
    expect(hostImporters()).toEqual([...OUTER_IMPORTERS].sort());
  });
});
