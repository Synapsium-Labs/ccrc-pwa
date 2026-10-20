// ARCH-05 (#551, D-5896): the coordination policy files stay off the database adapter. A policy file turns impure
// through what it imports. Before D-5896, one `import { tx } from './db.js'` at the top of `coord/rundefs.ts` put
// every file that wanted a marker constant from it (`RECLAIM_PAUSE_MARKER`) onto `node:sqlite`. The coord ring scan in
// `single-definition.test.ts` sees only a DIRECT `./db.js` import, so it could not see this. This test walks the
// whole runtime import graph instead.
//
// A RUNTIME edge is what survives compilation. The server's tsconfig has no `verbatimModuleSyntax`, so tsc elides
// `import type { … }` and an `import { type A, type B }` whose every specifier is a type. Any other import, a
// re-export, a bare `import '…'` and a dynamic `import('…')` is an edge.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = path.join(ROOT, 'server', 'src');
const rel = (f: string): string => path.relative(ROOT, f).split(path.sep).join('/');

/** Comments blanked: a docstring may name the very import it says the file does not take. */
const codeOnly = (s: string): string => s
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, (m, p: string) => p + ' '.repeat(m.length - p.length));

/** A brace clause whose every specifier says `type` is elided by tsc, so it is no edge. */
const allTypeClause = (clause: string): boolean => {
  const b = /^\s*\{([^}]*)\}\s*$/.exec(clause);
  if (b === null) return false;
  const names = b[1]!.split(',').map((x) => x.trim()).filter((x) => x !== '');
  return names.length > 0 && names.every((x) => /^type\s/.test(x));
};

/** The specifier of every runtime edge in one source text. */
function runtimeSpecifiers(src: string): string[] {
  const c = codeOnly(src);
  const out: string[] = [];
  for (const m of c.matchAll(/^\s*(?:import|export)\s+(type\s+)?([^'";]*?)\bfrom\s*(['"])([^'"]+)\3/gm)) {
    if (m[1] === undefined && !allTypeClause(m[2]!)) out.push(m[4]!);
  }
  for (const m of c.matchAll(/^\s*import\s*(['"])([^'"]+)\1/gm)) out.push(m[2]!);
  for (const m of c.matchAll(/\bimport\s*\(\s*(['"])([^'"]+)\1/g)) out.push(m[2]!);
  return out;
}

/** A relative specifier to the file on disk (`.js` is the emitted name of a `.ts` source); a bare one as itself. */
function resolveSpec(from: string, spec: string): string {
  if (!spec.startsWith('.')) return spec;
  const p = path.resolve(path.dirname(from), spec);
  for (const c of [p.replace(/\.js$/, '.ts'), p.replace(/\.mjs$/, '.mts'), p, `${p}.ts`]) {
    if (/\.(ts|mts|js|mjs)$/.test(c) && existsSync(c)) return c;
  }
  throw new Error(`${rel(from)}: ${spec} resolves to no file — the walk would silently stop here`);
}

/** The shortest runtime import chain from `start` to `target`, or null when there is none. */
function chainTo(start: string, target: string): string[] | null {
  const prev = new Map<string, string | null>([[start, null]]);
  const queue = [start];
  while (queue.length > 0) {
    const f = queue.shift()!;
    if (f === target) {
      const chain: string[] = [];
      for (let x: string | null = f; x !== null; x = prev.get(x) ?? null) chain.unshift(x.startsWith('/') ? rel(x) : x);
      return chain;
    }
    if (!path.isAbsolute(f) || /\.d\.m?ts$/.test(f)) continue;
    for (const spec of runtimeSpecifiers(readFileSync(f, 'utf8'))) {
      const next = resolveSpec(f, spec);
      if (!prev.has(next)) { prev.set(next, f); queue.push(next); }
    }
  }
  return null;
}

const coord = (f: string): string => path.join(SRC, 'coord', f);
const src = (f: string): string => path.join(SRC, f);

describe('the import walk itself (CONTROL)', () => {
  it('sees each edge shape and skips the elided ones', () => {
    expect(runtimeSpecifiers([
      `import { a } from './a.js';`,
      `import b from "./b.js";`,
      `import { type C, d } from './cd.js';`,
      `import { type E } from './e.js';`,
      `import type { F } from './f.js';`,
      `export { g } from './g.js';`,
      `export type { H } from './h.js';`,
      `import './i.js';`,
      `const j = await import('./j.js');`,
      `// import { k } from './k.js';`,
      `/** import { l } from './l.js'; */`,
      `import {\n  m,\n  type N,\n} from './mn.js';`,
    ].join('\n'))).toEqual(['./a.js', './b.js', './cd.js', './g.js', './mn.js', './i.js', './j.js']);
  });

  it('finds the adapter from the adapter — a walk that finds nothing would pass every assertion below', () => {
    expect(chainTo(coord('db.ts'), 'node:sqlite')).toEqual(['server/src/coord/db.ts', 'node:sqlite']);
    // D-5896: `store.ts` takes `tx` from `tx.ts` now and holds the handle by type, so the two-hop control is
    // `config.ts`, which loads `db.ts` for its default path.
    expect(chainTo(src('config.ts'), 'node:sqlite')).toEqual(['server/src/config.ts', 'server/src/coord/db.ts', 'node:sqlite']);
    expect(chainTo(coord('routes.ts'), 'node:sqlite')).not.toBeNull();
    expect(chainTo(src('exec.ts'), 'node:child_process')).not.toBeNull();
  });
});

describe('the coordination policy files have no runtime path to node:sqlite (D-5896)', () => {
  // The five the audit named, and `rundefs.ts` itself: its transaction half is `rundefsTx.ts`, and `tx` is
  // `coord/tx.ts`, which needs only the handle's `exec` and takes `node:sqlite` as a type. `db.ts` re-exports it.
  const POLICY = ['childReclaim.ts', 'close.ts', 'kickoff.ts', 'expireArchived.ts', 'collectTempRoot.ts', 'rundefs.ts',
    'rundefsTx.ts', 'tx.ts'];
  for (const f of POLICY) {
    it(`coord/${f}`, () => {
      expect(existsSync(coord(f)), `coord/${f} is gone — a moved file must turn this red, not disarm it`).toBe(true);
      expect(chainTo(coord(f), 'node:sqlite'), `coord/${f} reaches node:sqlite`).toBeNull();
    });
  }
});

describe('pure constants are imported from their pure homes, not through an adapter (D-5896)', () => {
  /** The direct runtime edges of one file, resolved. */
  const edgesOf = (f: string): string[] => runtimeSpecifiers(readFileSync(f, 'utf8')).map((s) => resolveSpec(f, s));

  it('NODE_ID_RE: no reader takes a runtime import of coord/store.ts for it', () => {
    for (const f of ['token/link.ts', 'token/door.ts', 'token/driver.ts', 'update/inventory.ts', 'accounts/audit.ts']) {
      expect(edgesOf(src(f)), `${f} imports coord/store.ts at runtime`).not.toContain(coord('store.ts'));
    }
  });

  it('UNMEASURED: lifecycle.ts no longer reaches exec.ts (node:child_process) at runtime', () => {
    expect(edgesOf(src('lifecycle.ts'))).not.toContain(src('exec.ts'));
  });

  it('configDirFor: turnverdict.ts no longer imports config.ts (and through it coord/db.ts) at runtime', () => {
    expect(edgesOf(src('turnverdict.ts'))).not.toContain(src('config.ts'));
    expect(chainTo(src('configDir.ts'), 'node:sqlite'), 'configDir.ts is the pure half').toBeNull();
  });
});
