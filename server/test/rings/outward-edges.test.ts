// D-6045, stage 2 (plan docs/superpowers/plans/2026-10-19-consolidation-w0-pins.md, Task C0n; ARCH-04 (#545)).
// RING RULE: a `server/src` runtime import points inward or sideways, never outward. "Imports point inward" (the
// 08-10 spec): an L1 decision that loads an L3 adapter at runtime cannot be tested without that adapter's I/O, and
// an adapter that loads delivery code drags the scheduler in with it. Each file's ring is decided by `ring.ts` from
// its own imports, timers and header (ARCH-02a's rules), never from what it imports, so an outward edge is visible
// rather than moving its importer outward.
//
// A type-only edge (`import type`, every name a per-name `type`, a type query) moves nothing and is not counted.
// The edges on the tree the day the rule landed are `outward-edges.data.ts`, held exactly: a new one is red, and an
// entry whose edge is gone is red until it is deleted. `exemption-age.test.ts` keeps the set from going stale.
// An exemption is a file pair: a new import line or a new name inside an exempt pair is not red until ARCH-05
// (#551) drains the pair; a new pair is.
import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { parseFile, parseSource } from '../scan/parse.js';
import { OUTWARD_EDGE_EXEMPTIONS } from './outward-edges.data.js';
import { malformedEntries } from './exemptions.js';
import { DOCS_RING_ROLES, outwardRuntimeEdges, serverRing, type Ring } from './ring.js';
import { REPO, walkSrc } from './walkSrc.js';

const files = (): string[] => walkSrc({ roots: ['server/src'], min: 170 });
const exists = (r: string): boolean => existsSync(path.join(REPO, r));

/** Every file's ring, `shared/` as L0, memoised over one run. */
const rings = new Map<string, Ring>();
const ringOf = (r: string): Ring | null => {
  if (r.startsWith('shared/')) return 'L0';
  if (!r.startsWith('server/src/') || !exists(r)) return null;
  if (!rings.has(r)) rings.set(r, serverRing(r).ring);
  return rings.get(r)!;
};

const ringOfSource = (file: string, lines: string[]): Ring => serverRing(file, parseSource(lines.join('\n'))).ring;

describe('server/src runtime imports never point outward (ARCH-04 stage 2, D-6045)', () => {
  it('CONTROL: the ring rules, clause by clause, from a file\'s own facts', () => {
    expect(ringOfSource('server/src/index.ts', ["import { x } from './x.js';"])).toBe('L5');
    expect(ringOfSource('server/src/a.ts', ["import type { FastifyReply } from 'fastify';"])).toBe('L4');
    expect(ringOfSource('server/src/a.ts', ['class P { t: unknown; go() { this.t = setInterval(() => 1, 5); } }'])).toBe('L4');
    expect(ringOfSource('server/src/a.ts', ['let t: unknown = null;', 'export function go() { t = setTimeout(() => 1, 5); }'])).toBe('L4');
    expect(ringOfSource('server/src/a.ts', ['export function go() { const w = { timer: 0 as unknown }; w.timer = setTimeout(() => 1, 5); }'])).toBe('L4');
    expect(ringOfSource('server/src/a.ts', ["import { readFileSync } from 'node:fs';"])).toBe('L3');
    expect(ringOfSource('server/src/a.ts', ["import { spawn } from 'child_process';"])).toBe('L3');
    expect(ringOfSource('server/src/a.ts', ["import { WebSocket } from 'ws';"])).toBe('L3');
    expect(ringOfSource('server/src/a.ts', ['export function go() { let t; t = setTimeout(() => 1, 5); return t; }'])).toBe('L3');
    expect(ringOfSource('server/src/a.ts', ['export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));'])).toBe('L3');
    expect(ringOfSource('server/src/a.ts', ["import path from 'node:path';", "import { createHash } from 'node:crypto';", 'export const f = () => path.sep;'])).toBe('L1');
    expect(ringOfSource('server/src/a.ts', ["import type { Stats } from 'node:fs';", "import { type ReadStream } from 'node:fs';", 'export const f = (s: Stats) => s;'])).toBe('L1');
    expect(ringOfSource('server/src/a.ts', ["import type { A } from './a.js';", 'export interface P { a: A }', 'export type Q = P;'])).toBe('L2');
    expect(ringOfSource('server/src/a.ts', ['export interface P { a: 1 }', 'export const q = 1;'])).toBe('L1');
    expect(ringOfSource('server/src/a.ts', ['// The sweep: L4, it reads, logs and acts.', "import { x } from './x.js';", 'export const f = () => x;'])).toBe('L4');
    // A declaration moves a file outward only: an inward one is refused, and the facts decide.
    expect(ringOfSource('server/src/a.ts', ['// L1 policy.', "import { readFileSync } from 'node:fs';", 'export const f = readFileSync;'])).toBe('L3');
    // A reference to another file's ring is not a declaration.
    expect(ringOfSource('server/src/a.ts', ['// Reads the verdict (`coord/stall.ts`, L4) as data.', 'export const f = () => 1;'])).toBe('L1');
  });

  it('CONTROL: a planted runtime import of the db adapter from a new coord/ L1 file is an outward edge', () => {
    const file = 'server/src/coord/planted.ts';
    const planted = parseSource("import { tx } from './db.js';\nexport const f = () => tx;\n");
    expect(serverRing(file, planted).ring).toBe('L1');
    expect(outwardRuntimeEdges(file, planted, ringOf, exists).map((e) => `${e.fromRing} ${e.from} -> ${e.toRing} ${e.to}`))
      .toEqual(['L1 server/src/coord/planted.ts -> L3 server/src/coord/db.ts']);
    // The same import, type-only, moves nothing.
    for (const src of ["import type { Db } from './db.js';", "import { type Db } from './db.js';"]) {
      expect(outwardRuntimeEdges(file, parseSource(src), ringOf, exists), src).toEqual([]);
    }
  });

  it('CONTROL: the docs ring pin\'s role table, a declaration by the spec, is single-definition\'s copy', () => {
    const sd = parseFile(path.join(REPO, 'server/test/single-definition.test.ts'));
    const init = sd.bindings.find((b) => b.name === 'DOCS_RING_ROLES')?.init ?? '';
    const pinned = Object.fromEntries([...init.matchAll(/'([\w.]+)':\s*'(L[0-5])'/g)].map((m) => [m[1], m[2]]));
    expect(pinned).toEqual(DOCS_RING_ROLES);
  });

  it('CONTROL: the walk has a floor', () => {
    expect(() => walkSrc({ roots: ['server/src'], min: 1_000_000 })).toThrow(/below the floor/);
    expect(files()).toContain('server/src/coord/store.ts');
  });

  it('every exemption has a reason and a date', () => {
    expect(malformedEntries(OUTWARD_EDGE_EXEMPTIONS)).toEqual([]);
  });

  it('the outward runtime edges are exactly the exemptions', () => {
    const found = new Map<string, string[]>();
    for (const f of files()) {
      for (const e of outwardRuntimeEdges(f, parseFile(path.join(REPO, f)), ringOf, exists)) {
        const key = `${e.from} -> ${e.to}`;
        found.set(key, [...(found.get(key) ?? []), `${e.fromRing} -> ${e.toRing} :${e.line} {${e.names.join(', ')}}`]);
      }
    }
    const allowed = new Set(Object.keys(OUTWARD_EDGE_EXEMPTIONS));
    const fresh = [...found].filter(([k]) => !allowed.has(k)).map(([k, v]) => `${k} ${v.join('; ')}`);
    const stale = [...allowed].filter((k) => !found.has(k));
    expect(fresh, 'a runtime import points outward: take a port the consumer declares (ARCH-05, #551), make the '
      + 'import type-only, or move the value inward').toEqual([]);
    expect(stale, 'an exemption no longer occurs: delete it from outward-edges.data.ts').toEqual([]);
  });
});
