// Landing order wave 5e: the landing line's entry has ONE writer. Keyed on symbols and call sites (`scan/symbols.ts`),
// never a literal source pin, so the store's growth ceiling is not touched. A later sub-wave that adds a writer of
// `landing_entries` adds it here by name.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';
import { identifierReferences, parseSource, type ImportEdge, type ParsedFile } from './scan/parse.js';
import { callsIn, inlinedSourceOf, parsedFile, sqlStatementsInFile, symbolOf, REPO_ROOT } from './scan/symbols.js';
import { walkSrc } from './rings/walkSrc.js';

const STORE = 'server/src/coord/store.ts';
const ROUTES = 'server/src/coord/routes.ts';
const WRITER = 'CoordStore.advanceLanding';
const ADVANCE_ACT = 'registerCoordRoutes.advanceAct';
const FILES = walkSrc({ roots: ['server/src'], min: 150 });
const inWriter = (q: { file: string; start: number }) => {
  const s = symbolOf(STORE, WRITER);
  return q.file.endsWith(STORE) && q.start >= s.start && q.start < s.end;
};
const writes = (re: RegExp) => FILES.flatMap((f) => sqlStatementsInFile(f))
  .filter((q) => ['INSERT', 'UPDATE', 'REPLACE'].includes(q.verb) && re.test(q.source));

describe('the landing line has one writer (landing order wave 5e, D-7614)', () => {
  it('pinnedSha has one writer, advanceLanding', () => {
    expect(writes(/\bpinnedSha\b/i).length).toBeGreaterThanOrEqual(2);
    expect(writes(/\bpinnedSha\b/i).filter((q) => !inWriter(q)).map((q) => `${q.file}:${q.text}`)).toEqual([]);
  });

  it('ejections has one writer, advanceLanding', () => {
    expect(writes(/\bejections\b/i).length).toBeGreaterThanOrEqual(1);
    expect(writes(/\bejections\b/i).filter((q) => !inWriter(q)).map((q) => `${q.file}:${q.text}`)).toEqual([]);
  });

  it('every write of landing_entries is advanceLanding\'s (5e; a later sub-wave adds its writer here by name)', () => {
    const all = FILES.flatMap((f) => sqlStatementsInFile(f))
      .filter((q) => q.table === 'landing_entries' && ['INSERT', 'UPDATE', 'REPLACE', 'DELETE'].includes(q.verb));
    expect(all.length).toBeGreaterThanOrEqual(3);
    expect(all.filter((q) => !inWriter(q)).map((q) => `${q.file}:${q.text}`)).toEqual([]);
  });

  it('the merging-at detail is built only inside advanceLanding', () => {
    const calls = FILES.flatMap((f) => parsedFile(f).calls.filter((c) => c.name === 'mergingAtDetail').map((c) => ({ file: f, start: c.start })));
    expect(calls.length).toBeGreaterThanOrEqual(1);
    expect(calls.filter((q) => !inWriter(q))).toEqual([]);
  });

  it('advanceAct reaches the store through advanceLanding only', () => {
    const names = callsIn(symbolOf(ROUTES, ADVANCE_ACT)).map((c) => c.name);
    expect(names).toContain('advanceLanding');
    expect(names).not.toContain('advance');
  });

  it('advanceLanding has one caller, advanceAct', () => {
    const act = symbolOf(ROUTES, ADVANCE_ACT);
    const calls = FILES.flatMap((f) => parsedFile(f).calls.filter((c) => c.name === 'advanceLanding').map((c) => ({ file: f, start: c.start })));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.file.endsWith(ROUTES) && calls[0]!.start >= act.start && calls[0]!.start < act.end).toBe(true);
  });

  it('advanceLanding decides the edge before it writes, in one tx', () => {
    const src = inlinedSourceOf(symbolOf(STORE, WRITER));
    const at = (n: string) => { const i = src.indexOf(n); expect(i, n).toBeGreaterThan(-1); return i; };
    expect(at('transitionsFor(')).toBeLessThan(at('this.advanceInner('));
    expect(at('this.advanceInner(')).toBeLessThan(at('INSERT INTO landing_entries'));
    expect(src.split('tx(this.db').length - 1).toBe(1);
  });
});

describe('CLAUDE.md names the landing line among what a lost coord.db loses (D-7620)', () => {
  const flat = (s: string): string => s.replace(/\s+/g, ' ');
  const passage = (name: string, text: string, from: string, to: string): string => {
    const a = text.indexOf(from);
    expect(a, `${name}: the opening anchor is gone`).toBeGreaterThan(-1);
    const b = text.indexOf(to, a + from.length);
    expect(b, `${name}: the closing anchor is gone`).toBeGreaterThan(a);
    return flat(text.slice(a, b));
  };

  it('the coord.db bullet lists the landing line first', () => {
    const bullet = passage('the coord.db bullet', readFileSync(path.join(REPO_ROOT, 'CLAUDE.md'), 'utf8'),
      'what it adds on top', 'is gone without the snapshot');
    expect(bullet).toContain('what it adds on top — the landing line, mail, claims');
  });
});

describe('landingEntry.ts is the pure L1 module its header says it is (no fs, no node:sqlite, no clock)', () => {
  // Keyed on the scan library (scan/parse.ts through scan/symbols.ts), never a literal source pin: the file is parsed, so a
  // comment that names what the header promises not to use cannot trip a check. KNOWN WIDTH: the parse is syntax only, so the
  // clock is read through `identifierReferences` (`new Date()` and `Date.now()` alike); a clock reached through an alias
  // bound from another module or a computed name is out of width. `coord-policy-rings` keeps the runtime path to node:sqlite.
  const FILE = 'server/src/coord/landingEntry.ts';
  const NODE_BUILTINS = new Set(builtinModules.map((m) => m.replace(/^node:/, '')));
  const isNodeBuiltin = (specifier: string): boolean =>
    specifier.startsWith('node:') || NODE_BUILTINS.has(specifier.split('/')[0]!);
  const bindsValue = (edge: ImportEdge): boolean => {
    if (edge.kind === 'type-query' || edge.typeOnly) return false;
    if (edge.names.length === 0) return true;
    return !edge.names.every((n) => (edge.typeNames ?? []).includes(n));
  };
  const valueSpecifiers = (p: ParsedFile): string[] => p.imports.filter(bindsValue).map((x) => x.specifier);
  const nodeBuiltinSpecifiers = (p: ParsedFile): string[] => p.imports.map((x) => x.specifier).filter(isNodeBuiltin);
  const CLOCK_AND_FS = new Set(['Date', 'performance', 'fs', 'require', 'readFileSync', 'writeFileSync', 'readFile', 'writeFile']);
  const clockAndFsReferences = (p: ParsedFile): string[] =>
    identifierReferences(p.text, p.path, CLOCK_AND_FS).map((x) => `${x.line} ${x.name}`);
  const probe = (src: string): ParsedFile => parseSource(src, 'probe.ts');

  it('the scan is over real code, not an empty string', () => {
    const p = parsedFile(FILE);
    const fns = p.symbols.filter((x) => x.kind === 'function' || x.kind === 'variable-function').map((x) => x.name);
    expect(fns).toContain('decideLandingWrite');
    expect(fns).toContain('landingEntryOfRow');
    expect(p.calls.length).toBeGreaterThan(5);
    expect(p.imports.length).toBeGreaterThan(0);
  });

  it('CONTROL: the scans see a builtin in either quote, a value import, a clock and an fs use', () => {
    expect(nodeBuiltinSpecifiers(probe('import { readFileSync } from "node:fs";'))).toEqual(['node:fs']);
    expect(nodeBuiltinSpecifiers(probe("import { DatabaseSync } from 'node:sqlite';"))).toEqual(['node:sqlite']);
    expect(nodeBuiltinSpecifiers(probe("import { join } from 'path';"))).toEqual(['path']);
    expect(nodeBuiltinSpecifiers(probe("import { x } from '../../../shared/landingLine.js';"))).toEqual([]);
    expect(valueSpecifiers(probe("import { a } from './store.js';\nimport type { B } from './db.js';"))).toEqual(['./store.js']);
    expect(clockAndFsReferences(probe('const t = Date.now();'))).toEqual(['1 Date']);
    expect(clockAndFsReferences(probe('const t = new Date(1);'))).toEqual(['1 Date']);
    expect(clockAndFsReferences(probe("const b = readFileSync('x');"))).toEqual(['1 readFileSync']);
    expect(clockAndFsReferences(probe('// Date.now() is not used\nconst t = 1;'))).toEqual([]);
  });

  it('reads no clock and no filesystem', () => {
    expect(clockAndFsReferences(parsedFile(FILE)), 'landingEntry.ts reads the clock or reaches for a filesystem').toEqual([]);
  });

  it('imports no node builtin, and values only from shared/ (L0)', () => {
    const p = parsedFile(FILE);
    expect(nodeBuiltinSpecifiers(p), 'landingEntry.ts imports a node builtin').toEqual([]);
    expect(valueSpecifiers(p)).toEqual(['../../../shared/landingLine.js']);
  });
});
