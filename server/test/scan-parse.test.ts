// D-5853 (plan docs/superpowers/plans/2026-10-19-consolidation-w0-pins.md, Task C0f; ARCH-00 (#525)). The self-test of
// `scan/parse.ts`, the one TypeScript parser the server's test scanners use. It parses a fixture FILE holding an
// `import`, an `import type`, an exported literal union, a class method, an arrow property and functions nested in a
// method, a function and a const arrow, and asserts what the wrapper returns for each: syntax only, no type checker.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseFile, parseSource, retireFacts, wireFacts, type ParsedFile } from './scan/parse.js';

const FIXTURE = [
  "import { readFileSync, type Stats } from 'node:fs';",
  "import type { Widget } from './widget.js';",
  "import * as path from 'node:path';",
  "export type { Gadget } from './gadget.js';",
  '',
  "export type Mode = 'on' | 'off' | 'paused';",
  'export type Shape = { kind: string };',
  "type Hidden = 'a' | 'b';",
  '',
  'export class Holder {',
  '  private count = 0;',
  '  read(w: Widget): string {',
  '    function inner(): number { return 1; }',
  '    return String(inner() + this.count) + w;',
  '  }',
  '  onTick = (n: number): void => {',
  '    this.count += n;',
  '  };',
  '}',
  '',
  'export function top(): string {',
  "  function walk(): string { return 'b'; }",
  "  return readFileSync(path.join('a', walk()), 'utf8');",
  '}',
  'export const helper = async (x: number): Promise<number> => {',
  '  const twice = (n: number): number => n * 2;',
  '  return twice(x);',
  '};',
  '',
].join('\n');

// D-6045 (Task C0l; ARCH-04 (#545), stage 1): a type query is an import edge of its own kind, always type-only, so a
// ring rule sees `import('fastify').FastifyReply` as it sees `import type { FastifyReply } from 'fastify'`.
describe('scan/parse.ts lists a type query as a type-only edge (D-6045)', () => {
  it('names the qualifier for import(…).T, none for typeof import(…), and in a nested type position too', () => {
    const t = parseSource([
      "let r: import('fastify').FastifyReply;",
      "type M = typeof import('node:fs');",
      "type Q = Promise<{ e: import('../shared/api').NotifyEvent[] }>;",
      "type Deep = import('./a.js').Outer.Inner;",
    ].join('\n'));
    expect(t.imports.map(({ specifier, kind, typeOnly, names, line }) => ({ specifier, kind, typeOnly, names, line })))
      .toEqual([
        { specifier: 'fastify', kind: 'type-query', typeOnly: true, names: ['FastifyReply'], line: 1 },
        { specifier: 'node:fs', kind: 'type-query', typeOnly: true, names: [], line: 2 },
        { specifier: '../shared/api', kind: 'type-query', typeOnly: true, names: ['NotifyEvent'], line: 3 },
        { specifier: './a.js', kind: 'type-query', typeOnly: true, names: ['Outer'], line: 4 },
      ]);
  });
});

// D-6045, stage 2 (ARCH-04 (#545)): a per-name `type` is reported per name, so the outward-edges rule can tell an
// import that binds a value from one whose every name is a type.
describe('scan/parse.ts lists the names bound with a per-name type (D-6045, stage 2)', () => {
  it('for an import and an export … from; none for a whole-statement type, absent on the other kinds', () => {
    const t = parseSource([
      "import { type A, b, type C as D } from './x.js';",
      "import type { E } from './e.js';",
      "export { type F, g } from './f.js';",
      "export * from './all.js';",
      "import './side.js';",
      "const h = await import('./h.js');",
    ].join('\n'));
    expect(t.imports.map(({ specifier, typeNames }) => ({ specifier, typeNames }))).toEqual([
      { specifier: './x.js', typeNames: ['A', 'C'] },
      { specifier: './e.js', typeNames: [] },
      { specifier: './f.js', typeNames: ['F'] },
      { specifier: './all.js', typeNames: [] },
      { specifier: './side.js', typeNames: [] },
      { specifier: './h.js', typeNames: undefined },
    ]);
  });
});

describe('scan/parse.ts parses a fixture file (D-5853)', () => {
  let dir = '';
  let parsed: ParsedFile;
  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'scan-parse-'));
    const file = path.join(dir, 'fixture.ts');
    writeFileSync(file, FIXTURE);
    parsed = parseFile(file);
  });
  afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

  it('reads the file it is given', () => {
    expect(parsed.text).toBe(FIXTURE);
    expect(parsed.path).toBe(path.join(dir, 'fixture.ts'));
  });

  it('lists every import edge, a type-only one marked, a re-export by its kind', () => {
    expect(parsed.imports.map(({ specifier, kind, typeOnly, names, line }) => ({ specifier, kind, typeOnly, names, line })))
      .toEqual([
        { specifier: 'node:fs', kind: 'import', typeOnly: false, names: ['readFileSync', 'Stats'], line: 1 },
        { specifier: './widget.js', kind: 'import', typeOnly: true, names: ['Widget'], line: 2 },
        { specifier: 'node:path', kind: 'import', typeOnly: false, names: ['* as path'], line: 3 },
        { specifier: './gadget.js', kind: 'export-from', typeOnly: true, names: ['Gadget'], line: 4 },
      ]);
  });

  it('lists the exported type aliases, with the members of a literal union', () => {
    expect(parsed.exportedTypeAliases).toEqual([
      { name: 'Mode', literals: ['on', 'off', 'paused'], line: 6 },
      { name: 'Shape', literals: null, line: 7 },
    ]);
  });

  it('keys each symbol by its qualified name: a method, an arrow property, functions nested in a method, function, arrow',
    () => {
    expect(parsed.symbols.map(({ name, kind, line, endLine }) => ({ name, kind, line, endLine }))).toEqual([
      { name: 'Holder', kind: 'class', line: 10, endLine: 19 },
      { name: 'Holder.read', kind: 'method', line: 12, endLine: 15 },
      { name: 'Holder.read.inner', kind: 'function', line: 13, endLine: 13 },
      { name: 'Holder.onTick', kind: 'arrow-property', line: 16, endLine: 18 },
      { name: 'top', kind: 'function', line: 21, endLine: 24 },
      { name: 'top.walk', kind: 'function', line: 22, endLine: 22 },
      { name: 'helper', kind: 'variable-function', line: 25, endLine: 28 },
      { name: 'helper.twice', kind: 'variable-function', line: 26, endLine: 26 },
    ]);
  });

  it("a symbol's span is its source text, from its first token to its last", () => {
    const span = (name: string): string => {
      const s = parsed.symbols.find((x) => x.name === name)!;
      return parsed.text.slice(s.start, s.end);
    };
    expect(span('Holder.onTick')).toBe('onTick = (n: number): void => {\n    this.count += n;\n  };');
    expect(span('Holder.read.inner')).toBe('function inner(): number { return 1; }');
  });

  // D-5854 (Task C0g; ARCH-06 (#554)): the calls and bindings `scan/symbols.ts` and the literal source-pin ratchet read.
  it('lists every call in source order, with its callee, its chain head, its literal arguments and its binding', () => {
    expect(parsed.calls.map((c) => [c.callee, c.line])).toEqual([
      ['String', 14], ['inner', 14],
      ['readFileSync', 23], ['path.join', 23], ['walk', 23],
      ['twice', 27],
    ]);
    const t = parseSource([
      "const src = codeOnly(readFileSync(join(dir, 'watch.ts'), 'utf8'));",
      "const body = src.slice(src.indexOf('  tick('), src.indexOf('\\n  }\\n'));",
      "expect(body, 'the tick').not.toContain('sweep');",
      'expect(body).toMatch(/a\\.b/g);',
      'const read = (f: string): string => readFileSync(f, "utf8");',
    ].join('\n'));
    const pick = (c: (typeof t.calls)[number]): unknown =>
      ({ name: c.name, head: c.head, headArgs: c.headArgs, args: c.args, boundTo: c.boundTo, line: c.line });
    expect(t.calls.map(pick)).toEqual([
      { name: 'codeOnly', head: 'codeOnly', headArgs: null, args: [{ kind: 'other', text: "readFileSync(join(dir, 'watch.ts'), 'utf8')" }], boundTo: 'src', line: 1 },
      { name: 'readFileSync', head: 'readFileSync', headArgs: null, args: [{ kind: 'other', text: "join(dir, 'watch.ts')" }, { kind: 'string', text: 'utf8' }], boundTo: 'src', line: 1 },
      { name: 'join', head: 'join', headArgs: null, args: [{ kind: 'other', text: 'dir' }, { kind: 'string', text: 'watch.ts' }], boundTo: 'src', line: 1 },
      { name: 'slice', head: 'src', headArgs: null, args: [{ kind: 'other', text: "src.indexOf('  tick(')" }, { kind: 'other', text: "src.indexOf('\\n  }\\n')" }], boundTo: 'body', line: 2 },
      { name: 'indexOf', head: 'src', headArgs: null, args: [{ kind: 'string', text: '  tick(' }], boundTo: 'body', line: 2 },
      { name: 'indexOf', head: 'src', headArgs: null, args: [{ kind: 'string', text: '\n  }\n' }], boundTo: 'body', line: 2 },
      { name: 'toContain', head: 'expect', headArgs: ['body', "'the tick'"], args: [{ kind: 'string', text: 'sweep' }], boundTo: null, line: 3 },
      { name: 'expect', head: 'expect', headArgs: null, args: [{ kind: 'other', text: 'body' }, { kind: 'string', text: 'the tick' }], boundTo: null, line: 3 },
      { name: 'toMatch', head: 'expect', headArgs: ['body'], args: [{ kind: 'regex', text: '/a\\.b/g' }], boundTo: null, line: 4 },
      { name: 'expect', head: 'expect', headArgs: null, args: [{ kind: 'other', text: 'body' }], boundTo: null, line: 4 },
      { name: 'readFileSync', head: 'readFileSync', headArgs: null, args: [{ kind: 'other', text: 'f' }, { kind: 'string', text: 'utf8' }], boundTo: null, line: 5 },
    ]);
    expect(t.bindings.map((b) => [b.name, b.line])).toEqual([['src', 1], ['body', 2], ['read', 5]]);
    expect(t.bindings[1]!.init).toBe("src.slice(src.indexOf('  tick('), src.indexOf('\\n  }\\n'))");
  });

  it('parseSource takes text directly, and a .tsx name parses JSX', () => {
    const t = parseSource('export const View = () => <div>hi</div>;\n', 'view.tsx');
    expect(t.symbols.map((s) => s.name)).toEqual(['View']);
  });
});

describe('scan/parse.ts reads the totality facts: Record<X, true> maps, type guards, compared literals (D-6048)', () => {
  const FACTS = wireFacts(parseSource([
    "export type Mode = 'on' | 'off';",
    "export type Kind = 'a' | 'b';",
    "export type Tone = 'x' | 'y';",
    'const MODE_MAP: Record<Mode, true> = { on: true, off: true };',
    'const KIND_TABLE: Readonly<Record<Kind, true>> = { a: true, b: true };',
    'const TONES = { x: true, y: true } satisfies Record<Tone, true>;',
    'const NOT_A_MAP: Record<Mode, string> = { on: "1", off: "0" };',
    'type Shadow = Record<Kind, true>;',
    'function take(m: Record<Tone, true>): void {}',
    "export function isMode(v: unknown): v is Mode { return v === 'on' || 'off' == v; }",
    'const isKind = (v: unknown): v is Kind => true;',
    'function isMany(v: unknown): v is Array<Kind> { return true; }',
    'export function check(v: string): string {',
    "  switch (v) { case 'left': return v !== 'right' ? 'up' : 'down'; default: return v; }",
    '}',
  ].join('\n')));

  it('a Record<X, true> counts as a variable annotation (bare or Readonly) or a satisfies type, nowhere else', () => {
    expect(FACTS.recordTrueKeys).toEqual(['Mode', 'Kind', 'Tone']);
  });

  it('a type guard counts by its bare predicate type, a declaration or an arrow', () => {
    expect(FACTS.guardedTypes).toEqual(['Mode', 'Kind']);
  });

  it('a compared literal is an equality operand or a case label, in source order', () => {
    expect(FACTS.comparedLiterals).toEqual(['on', 'off', 'left', 'right']);
  });

  it('a form that gives nothing at runtime counts as neither: a declare map, an asserts predicate, a type-only guard', () => {
    const none = wireFacts(parseSource([
      "export type Mode = 'on' | 'off';",
      'declare const M: Record<Mode, true>;',
      'export function assertMode(v: unknown): asserts v is Mode {}',
      'type G = (v: unknown) => v is Mode;',
      'interface H { isMode(v: unknown): v is Mode }',
      'declare function isMode(v: unknown): v is Mode;',
    ].join('\n')));
    expect(none.recordTrueKeys).toEqual([]);
    expect(none.guardedTypes).toEqual([]);
  });
});

// D-7227 (ARCH-44, plan 2026-10-27-consolidation-arch44-retire.md, C4h): the retire censuses' walk, `retireFacts`. Its
// FIXTURE rows: each of its three answers (literals, signatures, aliases), a nested literal, an `as const` row, a
// `satisfies` row, an arrow `const` and a non-exported alias.
describe('scan/parse.ts reads the retire facts: literals, signatures, aliases (D-7227)', () => {
  const SRC = [
    "import type { KeyedQueue } from './queue.js';",
    "type Answer = Awaited<ReturnType<typeof reclaimChild>> | 'none';",
    'export type Run<T extends Answer> = () => Promise<T>;',
    "export const ROW = { name: 'temp-orphan', decide: ['capability', 'switches'], act: [{ step: 'presence', sync: true }] } as const;",
    "const CHECKED = { reason: 'archive-expired', nested: { deep: 1 } } satisfies Row;",
    "const TYPED: Row = { reason: 'child-spent' };",
    'let LOOSE = { notConst: true };',
    'export function port(deps: Deps, id: string): Port {',
    '  const inner = () => ({ not: 1 });',
    '  return {',
    '    capability: () => ccdCan(deps.fleetState, \'wsCollect\'),',
    '    switches: async () => collectSwitches(deps.io, deps.cfg.registryDir),',
    '    async audit() { return collectAudit(deps, id); },',
    '    deps,',
    '    ...extra,',
    '  };',
    '}',
    'export const own = <T extends Answer>(queue: Pick<KeyedQueue, \'run\'>, id: string, run: Run<T>): Promise<T> => queue.run(id, run);',
    'export const arrowPort = (id: string) => ({ id });',
    'function bare(a, b: number) { return 1; }',
  ].join('\n');
  const parsed = parseSource(SRC, 'retire-fixture.ts');
  const facts = retireFacts(parsed);
  const at = (s: { start: number; end: number }): string => SRC.slice(s.start, s.end);

  it('literals: a top-level const literal and a top-level function\'s return literal, keyed by name and name#return', () => {
    expect(Object.keys(facts.literals).sort()).toEqual(['CHECKED', 'ROW', 'TYPED', 'arrowPort#return', 'port#return']);
    const port = facts.literals['port#return']!;
    expect(port.properties.map((x) => [x.name, x.kind, x.async])).toEqual([
      ['capability', 'arrow', false], ['switches', 'arrow', true], ['audit', 'method', true], ['deps', 'shorthand', false],
      [null, 'property', false],
    ]);
    expect(at(port.properties[0]!)).toBe("capability: () => ccdCan(deps.fleetState, 'wsCollect')");
    expect(at(port)).toMatch(/^\{[\s\S]*\}$/);
  });

  it('retireFacts: an as const row\'s literal is read, its array elements by text and span, a nested literal included', () => {
    const row = facts.literals['ROW']!;
    expect(row.properties.map((x) => x.name)).toEqual(['name', 'decide', 'act']);
    const decide = row.properties[1]!;
    expect(decide.elements!.map((e) => e.text)).toEqual(["'capability'", "'switches'"]);
    expect(decide.elements!.map((e) => at(e))).toEqual(["'capability'", "'switches'"]);
    const act = row.properties[2]!.elements![0]!;
    expect(act.literal!.properties.map((x) => [x.name, at(x)])).toEqual([['step', "step: 'presence'"], ['sync', 'sync: true']]);
  });

  it('retireFacts: a satisfies row\'s literal is read, with its nested literal; a typed const too; a let is not', () => {
    const checked = facts.literals['CHECKED']!;
    expect(checked.properties.map((x) => x.name)).toEqual(['reason', 'nested']);
    expect(checked.properties[1]!.literal!.properties.map((x) => x.name)).toEqual(['deep']);
    expect(facts.literals['TYPED']!.properties.map((x) => x.name)).toEqual(['reason']);
    expect(facts.literals['LOOSE']).toBeUndefined();
  });

  it('signatures: every top-level function and arrow const, each parameter\'s annotation (or null) and the return type (or null)', () => {
    expect(Object.keys(facts.signatures).sort()).toEqual(['arrowPort', 'bare', 'own', 'port']);
    expect(facts.signatures['own']).toMatchObject({ params: ["Pick<KeyedQueue, 'run'>", 'string', 'Run<T>'],
      paramNames: ['queue', 'id', 'run'], returnType: 'Promise<T>', typeParams: 'T extends Answer' });
    expect(facts.signatures['port']).toMatchObject({ params: ['Deps', 'string'], paramNames: ['deps', 'id'], returnType: 'Port', typeParams: null });
    expect(facts.signatures['arrowPort']).toMatchObject({ params: ['string'], returnType: null });
    expect(facts.signatures['bare']).toMatchObject({ params: [null, 'number'], paramNames: ['a', 'b'], returnType: null });
    expect(at(facts.signatures['port']!)).toMatch(/^export function port\(/);
    expect(facts.signatures['inner']).toBeUndefined();
  });

  it('aliases: every top-level type alias, a non-exported one included, with its right-hand side and type parameters', () => {
    expect(facts.aliases).toEqual({
      Answer: { name: 'Answer', exported: false, text: "Awaited<ReturnType<typeof reclaimChild>> | 'none'", typeParams: null },
      Run: { name: 'Run', exported: true, text: '() => Promise<T>', typeParams: 'T extends Answer' },
    });
  });

  it('leaves ParsedFile as it was: no field is added to the shared walk', () => {
    expect(Object.keys(parsed).sort()).toEqual(['bindings', 'calls', 'comparisons', 'exportedTypeAliases', 'imports', 'path', 'symbols', 'text']);
  });
});
