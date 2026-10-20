// D-5853 (plan docs/superpowers/plans/2026-10-19-consolidation-w0-pins.md, Task C0f; ARCH-00 (#525)). The self-test of
// `scan/parse.ts`, the one TypeScript parser the server's test scanners use. It parses a fixture FILE holding an
// `import`, an `import type`, an exported literal union, a class method, an arrow property and functions nested in a
// method, a function and a const arrow, and asserts what the wrapper returns for each: syntax only, no type checker.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseFile, parseSource, wireFacts, type ParsedFile } from './scan/parse.js';

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
