// Landing order wave 5e, Task 2: the landing line's decider (`landingOrder`) and the second-ejection notice's decider
// (`landingEjectionAsk`), both pure L1 folds in `coord/landingLine.ts`. The cases are data: C1 to C18 of the plan.
import { describe, it, expect } from 'vitest';
import { builtinModules } from 'node:module';
import { identifierReferences, parseSource, type ImportEdge, type ParsedFile } from './scan/parse.js';
import { parsedFile } from './scan/symbols.js';
import { landingOrder, landingEjectionAsk, LANDING_EJECTION_ASK_AT } from '../src/coord/landingLine.js';
import {
  LANDING_PAUSE_BY, LANDING_PAUSE_BYS, type LandingEntry, type LandingLineFlags, type LandingOrder,
} from '../../shared/landingLine.js';

/** Every entry's `id` is its `pr` plus 100, so an edge read as a PR number points at nothing and the cases tell the
 *  two readings apart. */
const e = (pr: number, over: Partial<LandingEntry> = {}): LandingEntry => Object.freeze({
  id: pr + 100, project: 'project-a', pr, pinnedSha: 'a'.repeat(40), handoffCommit: 'a'.repeat(40), runId: pr * 10,
  state: 'pinned', baseSha: null, ejectionKind: null, ejections: 0, afterIds: [], fixesMain: false,
  setBy: 'coordinator', pinnedAt: 1000 + pr, ...over }) as LandingEntry;

const OPEN: LandingLineFlags = { operatorPaused: false, mainRedHold: false };
const OP: LandingLineFlags = { operatorPaused: true, mainRedHold: false };
const RED: LandingLineFlags = { operatorPaused: false, mainRedHold: true };
const BOTH: LandingLineFlags = { operatorPaused: true, mainRedHold: true };

const prs = (o: LandingOrder) => o.order.map((x) => x.pr);
const head = (o: LandingOrder) => (o.paused ? 'paused' : o.head?.pr ?? null);

type Case = [string, LandingEntry[], LandingLineFlags, number[], number | null | 'paused', string[] | null];
const CASES: Case[] = [
  ['C1 an empty line', [], OPEN, [], null, null],
  ['C2 first-green by pinnedAt', [e(1, { pinnedAt: 200 }), e(2, { pinnedAt: 150 }), e(3, { pinnedAt: 100 })], OPEN, [3, 2, 1], 3, null],
  ['C3 a pinnedAt tie breaks by pr', [e(9, { pinnedAt: 100 }), e(4, { pinnedAt: 100 })], OPEN, [4, 9], 4, null],
  ['C4 only pinned entries are in the line',
    [e(5, { state: 'landed' }), e(6, { state: 'withdrawn' }), e(7, { state: 'ejected', ejections: 1 }), e(8), e(9, { state: 'unknown' })],
    OPEN, [8], 8, null],
  ['C5 a fixesMain entry jumps the line', [e(1, { pinnedAt: 100 }), e(2, { pinnedAt: 300, fixesMain: true })], OPEN, [2, 1], 2, null],
  ['C6 two fixesMain entries keep first-green between them',
    [e(1, { pinnedAt: 100 }), e(2, { pinnedAt: 300, fixesMain: true }), e(3, { pinnedAt: 200, fixesMain: true })], OPEN, [3, 2, 1], 3, null],
  ['C7 an after edge is honoured', [e(1, { pinnedAt: 100, afterIds: [102] }), e(2, { pinnedAt: 200 })], OPEN, [2, 1], 2, null],
  ['C8 an after edge outranks the fixesMain jump',
    [e(1, { pinnedAt: 100, fixesMain: true, afterIds: [102] }), e(2, { pinnedAt: 200 })], OPEN, [2, 1], 2, null],
  ['C9 an edge to an ejected entry holds the entry back',
    [e(1, { pinnedAt: 100, afterIds: [107] }), e(7, { state: 'ejected', ejections: 1 }), e(3, { pinnedAt: 200 })], OPEN, [3, 1], 3, null],
  ['C10 an edge to a landed, withdrawn or absent id holds nothing',
    [e(1, { afterIds: [105, 106, 199] }), e(5, { state: 'landed' }), e(6, { state: 'withdrawn' })], OPEN, [1], 1, null],
  ['C11 a cycle goes last and never heads',
    [e(1, { pinnedAt: 100, afterIds: [102] }), e(2, { pinnedAt: 200, afterIds: [101] }), e(3, { pinnedAt: 300 })], OPEN, [3, 1, 2], 3, null],
  ['C12 a line of only a cycle has no head', [e(1, { afterIds: [102] }), e(2, { afterIds: [101] })], OPEN, [1, 2], null, null],
  ['C13 a self-edge never heads', [e(1, { afterIds: [101] })], OPEN, [1], null, null],
  ['C14 an operator pause keeps the order and names no head', [e(1, { pinnedAt: 200 }), e(2, { pinnedAt: 100 })], OP, [2, 1], 'paused', ['operator']],
  ['C15 a main-red hold pauses the line', [e(1)], RED, [1], 'paused', ['main-red']],
  ['C16 both flags: operator first', [e(1)], BOTH, [1], 'paused', ['operator', 'main-red']],
  ['C17 a fixesMain entry is held by main-red too (the literal ruling)', [e(1, { fixesMain: true })], RED, [1], 'paused', ['main-red']],
  ['C18 an edge to an unknown entry holds the entry back',
    [e(1, { pinnedAt: 100, afterIds: [109] }), e(9, { state: 'unknown' }), e(3, { pinnedAt: 200 })], OPEN, [3, 1], 3, null],
];

describe('landingOrder: the cases, as data', () => {
  it.each(CASES)('%s', (_n, entries, flags, wantOrder, wantHead, wantBy) => {
    const o = landingOrder(entries, flags);
    expect(prs(o)).toEqual(wantOrder);
    expect(head(o)).toEqual(wantHead);
    expect(o.paused ? o.by : null).toEqual(wantBy);
  });
});

describe('landingOrder: the spec\'s pause rows, as folds over the flags (spec §5.5 item 6)', () => {
  // D-7621: the spec's two pause rows as flag sequences.
  const fold = (steps: LandingLineFlags[]) => steps.map((f) => { const o = landingOrder([e(1)], f); return o.paused ? o.by : o.head?.pr ?? null; });
  it('an operator pause survives a red-to-green transition', () => {
    expect(fold([BOTH, OP])).toEqual([['operator', 'main-red'], ['operator']]);
  });
  it('an operator pause set BEFORE main goes red survives the red and the later green', () => {
    expect(fold([OPEN, OP, BOTH, OP])).toEqual([1, ['operator'], ['operator', 'main-red'], ['operator']]);
  });
  it('CONTROL: a main-red hold alone clears on green', () => {
    expect(fold([RED, OPEN])).toEqual([['main-red'], 1]);
  });
});

describe('landingOrder is pure', () => {
  it('does not mutate its input, and answers the same twice', () => {
    const input = Object.freeze([e(2, { pinnedAt: 100 }), e(1, { pinnedAt: 50 })]);
    expect(landingOrder(input, OPEN)).toEqual(landingOrder(input, OPEN));
    expect(input.map((x) => x.pr)).toEqual([2, 1]);
  });
  it('L0 lists the pause words in the order by names them', () => {
    expect(LANDING_PAUSE_BYS).toEqual(['operator', 'main-red']);
    expect(LANDING_PAUSE_BY).toEqual({ operator: 'operatorPaused', 'main-red': 'mainRedHold' });
  });
});

describe('landingLine.ts is the pure L1 module its header says it is', () => {
  // Keyed on the scan library (scan/parse.ts through scan/symbols.ts), not on a literal source pin: the file is parsed,
  // so a comment that names what the header promises not to use cannot trip a check, and a reformat cannot hide one.
  // KNOWN WIDTH: the parse is syntax only. `CallSite` records no `new` expression, so the clock is read through
  // `identifierReferences` (any use of the identifier `Date` or `performance`, which sees `new Date()` and `Date.now()`
  // alike); a clock reached through an alias bound from another module, `globalThis['Date']` or a computed name is out
  // of width, and so is a `require` of a builtin (`require(…)` is no import edge; its identifier is what is pinned).
  const FILE = 'server/src/coord/landingLine.ts';
  const NODE_BUILTINS = new Set(builtinModules.map((m) => m.replace(/^node:/, '')));
  /** `node:fs`, `fs`, `fs/promises`, `node:test`: a builtin by its scheme or by its bare name. */
  const isNodeBuiltin = (specifier: string): boolean =>
    specifier.startsWith('node:') || NODE_BUILTINS.has(specifier.split('/')[0]!);
  /** An edge binding a value: not `import type`, and not an edge whose every name is a per-name `type`. A side-effect
   *  import (no names) binds nothing but runs the module, so it is an edge of its own kind below. */
  const bindsValue = (edge: ImportEdge): boolean => {
    if (edge.kind === 'type-query' || edge.typeOnly) return false;
    if (edge.names.length === 0) return true;
    return !edge.names.every((n) => (edge.typeNames ?? []).includes(n));
  };
  const valueSpecifiers = (p: ParsedFile): string[] => p.imports.filter(bindsValue).map((x) => x.specifier);
  const nodeBuiltinSpecifiers = (p: ParsedFile): string[] => p.imports.map((x) => x.specifier).filter(isNodeBuiltin);
  const sideEffectImports = (p: ParsedFile): ImportEdge[] => p.imports.filter((x) => x.kind === 'import' && !x.typeOnly && x.names.length === 0);
  const dynamicOrReExport = (p: ParsedFile): ImportEdge[] => p.imports.filter((x) => x.kind === 'dynamic' || x.kind === 'export-from');
  const CLOCK_AND_FS = new Set(['Date', 'performance', 'fs', 'require', 'readFileSync', 'writeFileSync', 'readFile', 'writeFile']);
  const clockAndFsReferences = (p: ParsedFile): string[] =>
    identifierReferences(p.text, p.path, CLOCK_AND_FS).map((x) => `${x.line} ${x.name}`);
  const STORE_NAMES = new Set(['CoordStore', 'coord', 'db']);
  const storeReaches = (p: ParsedFile): string[] => [
    ...identifierReferences(p.text, p.path, STORE_NAMES).map((x) => `${x.line} ${x.name}`),
    ...p.calls.filter((c) => c.head !== null && STORE_NAMES.has(c.head)).map((c) => `${c.line} ${c.callee}`),
    ...p.imports.filter((x) => /(^|\/)(store|db|schema)(\.js)?$/.test(x.specifier)).map((x) => `${x.line} ${x.specifier}`),
  ];
  const probe = (src: string): ParsedFile => parseSource(src, 'probe.ts');

  it('the scan is over real code, not an empty string', () => {
    const p = parsedFile(FILE);
    const fns = p.symbols.filter((s) => s.kind === 'function' || s.kind === 'variable-function').map((s) => s.name);
    expect(fns).toContain('landingOrder');
    expect(fns).toContain('landingEjectionAsk');
    expect(p.symbols.length).toBeGreaterThanOrEqual(3);
    expect(p.calls.length).toBeGreaterThan(10);
    expect(p.imports.length).toBeGreaterThan(0);
  });
  it('CONTROL: the scans see a builtin, either quote, a re-export, a dynamic import, a clock and a store reach', () => {
    expect(nodeBuiltinSpecifiers(probe(`import { readFileSync } from "node:fs";`))).toEqual(['node:fs']);
    expect(nodeBuiltinSpecifiers(probe(`import { readFileSync } from 'node:fs';`))).toEqual(['node:fs']);
    expect(nodeBuiltinSpecifiers(probe(`import { join } from 'path';`))).toEqual(['path']);
    expect(nodeBuiltinSpecifiers(probe(`import { readFile } from 'fs/promises';`))).toEqual(['fs/promises']);
    expect(nodeBuiltinSpecifiers(probe(`import { x } from '../../../shared/landingLine.js';`))).toEqual([]);
    expect(sideEffectImports(probe(`import "./rundefs.js";`)).length).toBe(1);
    expect(sideEffectImports(probe(`import { x } from './rundefs.js';`)).length).toBe(0);
    expect(sideEffectImports(probe(`import type { x } from './rundefs.js';`)).length).toBe(0);
    expect(dynamicOrReExport(probe(`export { survivorOf } from './rundefs.js';`)).length).toBe(1);
    expect(dynamicOrReExport(probe(`export * from './rundefs.js';`)).length).toBe(1);
    expect(dynamicOrReExport(probe(`const m = await import('./rundefs.js');`)).length).toBe(1);
    expect(dynamicOrReExport(probe(`export const x = 1;`)).length).toBe(0);
    expect(valueSpecifiers(probe(`import { survivorOf } from "./rundefs.js";\nimport { x } from '../../../shared/landingLine.js';`)))
      .toEqual(['./rundefs.js', '../../../shared/landingLine.js']);
    expect(valueSpecifiers(probe(`import type { A } from './rundefs.js';`))).toEqual([]);
    expect(valueSpecifiers(probe(`import { type A, type B } from './rundefs.js';`))).toEqual([]);
    expect(valueSpecifiers(probe(`import { type A, b } from './rundefs.js';`))).toEqual(['./rundefs.js']);
    expect(clockAndFsReferences(probe(`const t = Date.now();`))).toEqual(['1 Date']);
    expect(clockAndFsReferences(probe(`const t = new Date(1);`))).toEqual(['1 Date']);
    expect(clockAndFsReferences(probe(`const t = performance.now();`))).toEqual(['1 performance']);
    expect(clockAndFsReferences(probe(`const t = fs.readFileSync('x');`)).length).toBeGreaterThan(0);
    expect(clockAndFsReferences(probe(`const m = require('node:fs');`))).toEqual(['1 require']);
    expect(clockAndFsReferences(probe(`// Date.now() is not used\nconst t = 1;`))).toEqual([]);
    expect(storeReaches(probe(`const r = db.prepare('x');`)).length).toBeGreaterThan(0);
    expect(storeReaches(probe(`const r = coord.landingProject('a');`)).length).toBeGreaterThan(0);
    expect(storeReaches(probe(`import { CoordStore } from './store.js';`)).length).toBeGreaterThan(0);
    expect(storeReaches(probe(`const r = [1].map((x) => x);`))).toEqual([]);
  });
  it('has no clock, no fs and no other node builtin', () => {
    const p = parsedFile(FILE);
    expect(clockAndFsReferences(p), 'landingLine.ts reads the clock or reaches for a filesystem').toEqual([]);
    expect(nodeBuiltinSpecifiers(p), 'landingLine.ts imports a node builtin').toEqual([]);
  });
  it('imports values only from shared/landingLine.ts (L0)', () => {
    expect(valueSpecifiers(parsedFile(FILE))).toEqual(['../../../shared/landingLine.js']);
  });
  it('has no side-effect import, dynamic import or re-export', () => {
    const p = parsedFile(FILE);
    expect(sideEffectImports(p), 'a side-effect import').toEqual([]);
    expect(dynamicOrReExport(p), 'a dynamic import or a re-export').toEqual([]);
  });
  it('reaches no store', () => {
    expect(storeReaches(parsedFile(FILE)), 'landingLine.ts reaches the store').toEqual([]);
  });
});

describe('landingEjectionAsk', () => {
  it('is due at the second ejection only', () => {
    expect(landingEjectionAsk(e(42, { state: 'ejected', ejections: 1, baseSha: 'b'.repeat(40), ejectionKind: 'new-head' }))).toEqual({ due: false });
    expect(landingEjectionAsk(e(42, { state: 'ejected', ejections: 3, baseSha: 'b'.repeat(40), ejectionKind: 'new-head' }))).toEqual({ due: false });
    expect(landingEjectionAsk(e(42, { state: 'pinned', ejections: 2 }))).toEqual({ due: false });
    expect(LANDING_EJECTION_ASK_AT).toBe(2);
  });
  it('words the notice with the run, the PR, the kind and the base', () => {
    expect(landingEjectionAsk(e(42, { state: 'ejected', ejections: 2, baseSha: '0123456789ab' + 'c'.repeat(28), ejectionKind: 'conflict' }))).toEqual({
      due: true, tag: 'landing-ejected-project-a-42', title: 'Landing: project-a #42 ejected twice',
      body: 'run 420, project-a #42: ejected from the landing line a second time (conflict against base 0123456789ab). The line holds nothing back; you decide whether it lands again, is fixed by hand or is withdrawn.' });
  });
  it('says no run, and an unrecorded kind and base, when they are null', () => {
    expect((landingEjectionAsk(e(7, { state: 'ejected', ejections: 2, runId: null })) as { body: string }).body)
      .toBe('project-a #7 (no run): ejected from the landing line a second time (unrecorded against base unrecorded). The line holds nothing back; you decide whether it lands again, is fixed by hand or is withdrawn.');
  });
});
