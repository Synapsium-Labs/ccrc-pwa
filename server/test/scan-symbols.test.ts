// D-5854 (plan docs/superpowers/plans/2026-10-19-consolidation-w0-pins.md, Task C0g; ARCH-06 (#554), the W1a slice).
// The self-test of `scan/symbols.ts`: a slice keyed on a symbol's qualified name, over a method, an arrow-function
// property and nested functions; the slice follows code that MOVES and throws, by name, when the symbol is gone; and
// `callsIn` lists a symbol's calls in source order. Fixture files only, written to a temp dir.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { callsIn, sourceOfSymbol, symbolOf, REPO_ROOT } from './scan/symbols.js';

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
});
