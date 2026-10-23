// D-5854 (plan docs/superpowers/plans/2026-10-19-consolidation-w0-pins.md, Task C0g; ARCH-06 (#554), the W1a slice).
// The self-test of `scan/symbols.ts`: a slice keyed on a symbol's qualified name, over a method, an arrow-function
// property and nested functions; the slice follows code that MOVES and throws, by name, when the symbol is gone; and
// `callsIn` lists a symbol's calls in source order. Fixture files only, written to a temp dir.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { callsIn, inlinedSourceOf, sourceOfSymbol, sqlStatementsIn, sqlStatementsInFile, symbolOf, REPO_ROOT } from './scan/symbols.js';

const FIXTURE = [
  'export class Watcher {',
  '  private n = 0;',
  '  tick(): void {',
  '    this.sweepA();',
  '    function settle(x: number): number { return Math.max(x, 0); }',
  '    this.n = settle(this.n);',
  '    this.sweepB(1);',
  '  }',
  '  onPush = (title: string): void => {',
  "    this.record({ title }); this.send(title, 'now');",
  '  };',
  '  private sweepA(): void {}',
  '  private sweepB(_x: number): void {}',
  '  private record(_e: object): void {}',
  '  private send(_t: string, _w: string): void {}',
  '}',
  '',
  'export function outer(): number {',
  '  const inner = (k: number): number => k + 1;',
  '  return inner(2);',
  '}',
  '',
].join('\n');

/** The same code with `tick`'s first call moved below a new method: the text around it shifts, the symbol does not. */
const MOVED = FIXTURE.replace('export class Watcher {\n', 'export class Watcher {\n  helper(): void {}\n');

describe('scan/symbols.ts keys a source slice on a symbol (D-5854)', () => {
  let dir = '';
  let file = '';
  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'scan-symbols-'));
    file = path.join(dir, 'fixture.ts');
    writeFileSync(file, FIXTURE);
  });
  afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

  it('slices a method, an arrow-function property and nested functions by their qualified names', () => {
    writeFileSync(file, FIXTURE);
    expect(sourceOfSymbol(file, 'Watcher.tick')).toBe([
      'tick(): void {',
      '    this.sweepA();',
      '    function settle(x: number): number { return Math.max(x, 0); }',
      '    this.n = settle(this.n);',
      '    this.sweepB(1);',
      '  }',
    ].join('\n'));
    expect(sourceOfSymbol(file, 'Watcher.onPush'))
      .toBe("onPush = (title: string): void => {\n    this.record({ title }); this.send(title, 'now');\n  };");
    expect(sourceOfSymbol(file, 'Watcher.tick.settle')).toBe('function settle(x: number): number { return Math.max(x, 0); }');
    expect(sourceOfSymbol(file, 'outer.inner')).toBe('const inner = (k: number): number => k + 1;');
    expect(symbolOf(file, 'Watcher.onPush')).toMatchObject({ kind: 'arrow-property', line: 9, endLine: 11 });
  });

  it('follows code that moves: the slice is the same text after a method is added above it', () => {
    writeFileSync(file, FIXTURE);
    const before = sourceOfSymbol(file, 'Watcher.tick');
    writeFileSync(file, MOVED);
    expect(sourceOfSymbol(file, 'Watcher.tick')).toBe(before);
    expect(symbolOf(file, 'Watcher.tick').line).toBe(4);
  });

  it('throws by name when the symbol is renamed or gone, and when a name is ambiguous', () => {
    writeFileSync(file, FIXTURE.replace('  tick(): void {', '  pulse(): void {'));
    expect(() => sourceOfSymbol(file, 'Watcher.tick')).toThrow(/no symbol 'Watcher\.tick' in .*fixture\.ts/);
    writeFileSync(file, `${FIXTURE}export function outer(): number { return 0; }\n`);
    expect(() => sourceOfSymbol(file, 'outer')).toThrow("scan/symbols: 'outer' is declared 2 times in");
  });

  it('callsIn lists the symbol\'s calls in source order, a nested function\'s included, with their arguments', () => {
    writeFileSync(file, FIXTURE);
    expect(callsIn(symbolOf(file, 'Watcher.tick')).map((c) => c.callee))
      .toEqual(['this.sweepA', 'Math.max', 'settle', 'this.sweepB']);
    const push = callsIn(symbolOf(file, 'Watcher.onPush'));
    expect(push.map((c) => [c.name, c.head, c.args.map((a) => `${a.kind}:${a.text}`)])).toEqual([
      ['record', 'this', ['other:{ title }']],
      ['send', 'this', ['other:title', 'string:now']],
    ]);
    expect(callsIn(symbolOf(file, 'outer')).map((c) => c.callee)).toEqual(['inner']);
  });

  it('resolves a relative path against the repository root', () => {
    expect(symbolOf('server/test/scan/symbols.ts', 'sourceOfSymbol').file)
      .toBe(path.join(REPO_ROOT, 'server/test/scan/symbols.ts'));
  });

  it('sqlStatementsIn lists a symbol\'s SQL (a method, an arrow-function property, a nested function), a `+` chain and a template whole', () => {
    writeFileSync(file, SQL_FIXTURE);
    const at = (name: string): string[] => sqlStatementsIn(symbolOf(file, name)).map((q) => `${q.verb} ${q.table}`);
    expect(at('Store.bind')).toEqual(['UPDATE runs']);
    expect(at('Store.clear')).toEqual(['UPDATE runs', 'DELETE mail']);
    expect(at('Store.stamp')).toEqual(['UPDATE runs']);
    expect(at('Store.clear.drop')).toEqual(['DELETE mail']);
    const [chain] = sqlStatementsIn(symbolOf(file, 'Store.clear'));
    expect(chain).toMatchObject({ set: ' sessionId = NULL, workspace = NULL ', line: 10 });
    expect(chain!.text).toBe('UPDATE runs SET sessionId = NULL, workspace = NULL WHERE id = ?');
    expect(sqlStatementsIn(symbolOf(file, 'Store.stamp'))[0]!.text).toBe('UPDATE runs SET closedAt = CASE WHEN ? IN ${} THEN ? END WHERE id = ?');
    // A comment that quotes SQL, and a string that is not a statement, are not statements.
    expect(at('Store.quiet')).toEqual([]);
    expect(sqlStatementsInFile(file).map((q) => q.table)).toEqual(['runs', 'runs', 'runs', 'mail', 'runs']);
  });

  it('inlinedSourceOf keeps an order pin green when a body moves into a private helper, and splices each helper once', () => {
    writeFileSync(file, FIXTURE);
    const order = (t: string): number[] => ['this.sweepA();', 'this.n = settle(this.n);', 'this.sweepB(1);'].map((n) => t.indexOf(n));
    const inOrder = (xs: number[]): boolean => xs.every((x, i) => x >= 0 && (i === 0 || x > xs[i - 1]!));
    expect(inOrder(order(inlinedSourceOf(symbolOf(file, 'Watcher.tick'))))).toBe(true);
    // The body moved wholesale into a private method; `tick` only forwards.
    writeFileSync(file, FIXTURE.replace('  tick(): void {', '  tick(): void { this.tickBody(); }\n  private tickBody(): void {'));
    expect(inOrder(order(sourceOfSymbol(file, 'Watcher.tick')))).toBe(false);
    expect(inOrder(order(inlinedSourceOf(symbolOf(file, 'Watcher.tick'))))).toBe(true);
    // A helper called twice is spliced at its first call only; a free function has nothing to inline.
    writeFileSync(file, FIXTURE.replace('this.sweepB(1);', 'this.sweepA(); this.sweepB(1);'));
    expect(inlinedSourceOf(symbolOf(file, 'Watcher.tick')).split('private sweepA').length).toBe(2);
    expect(inlinedSourceOf(symbolOf(file, 'outer'))).toBe(sourceOfSymbol(file, 'outer'));
  });

  it('sqlStatementsIn follows code that moves: the same statements after a method is added above', () => {
    writeFileSync(file, SQL_FIXTURE);
    const before = sqlStatementsIn(symbolOf(file, 'Store.clear')).map((q) => q.text);
    writeFileSync(file, SQL_FIXTURE.replace('class Store {\n', 'class Store {\n  helper(): void {}\n'));
    expect(sqlStatementsIn(symbolOf(file, 'Store.clear')).map((q) => q.text)).toEqual(before);
  });
});

const SQL_FIXTURE = [
  'export class Store {',
  "  bind(id: number): void { this.db.prepare('UPDATE runs SET sessionId = ? WHERE id = ?').run(1, id); }",
  '  // UPDATE runs SET sessionId = ? WHERE id = ?  (a comment, not a statement)',
  '  quiet(): string { return "update the world"; }',
  '  stamp = (id: number): void => {',
  '    this.db.prepare(`UPDATE runs SET closedAt = CASE WHEN ? IN ${TERMINAL} THEN ? END WHERE id = ?`).run(id);',
  '  };',
  '  clear(id: number): void {',
  '    this.db.prepare(',
  "      'UPDATE runs SET sessionId = NULL, workspace = NULL ' +",
  "      'WHERE id = ?').run(id);",
  "    const drop = (m: number): void => { this.db.prepare('DELETE FROM mail WHERE id = ?').run(m); };",
  '    drop(id);',
  '  }',
  '  reconstruct(): void {',
  "    this.db.prepare('INSERT INTO runs (id, sessionId) VALUES (?, ?)').run(1, 2);",
  '  }',
  '}',
  '',
].join('\n');
