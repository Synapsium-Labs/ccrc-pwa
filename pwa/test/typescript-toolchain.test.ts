// Two TypeScripts live in this package, and only one of them may answer to `tsc`.
//
// - `typescript` is TypeScript 7, the native compiler. It is what `tsc --noEmit` (the `build` script, CI's pwa
//   typecheck step) and vitest's own type-level run (`typecheck.checker` defaults to the `tsc` on PATH) execute.
//   Its package entry carries no compiler API, only the version.
// - `typescript-api` is TypeScript 6 under another name, kept for its JavaScript API: the census and scan suites
//   (`literalWalker.ts` and the files beside it) parse the source with `ts.createSourceFile` and walk the tree.
//
// TypeScript 6 also ships a `tsc` bin, and npm links whichever bin it reaches first into `node_modules/.bin`.
// Measured: with the API under `@typescript/typescript6` (whose dependency hoists as `@typescript/old`, sorting before
// `typescript`), `.bin/tsc` pointed at TypeScript 6, so every "TypeScript 7" typecheck silently ran 6. This file
// is the red for that: the `tsc` on PATH must be TypeScript 7's, and the API alias must stay TypeScript 6.
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import ts from 'typescript-api';

const PWA = path.join(import.meta.dirname, '..');
const major = (version: string): number => Number(version.split('.')[0]);
const versionAt = (dir: string): string =>
  (JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')) as { version: string }).version;

describe('the two TypeScripts', () => {
  it('node_modules/.bin/tsc is TypeScript 7, the `typescript` package', () => {
    const bin = realpathSync(path.join(PWA, 'node_modules', '.bin', 'tsc'));
    const own = realpathSync(path.join(PWA, 'node_modules', 'typescript'));
    expect(bin.startsWith(own + path.sep), `.bin/tsc resolves to ${bin}, not into ${own}`).toBe(true);
    expect(major(versionAt(own))).toBe(7);
  });

  it('typescript-api is TypeScript 6, and its compiler API is the one the scans call', () => {
    expect(major(ts.version)).toBe(6);
    const file = ts.createSourceFile('probe.ts', 'const a = 1;', ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    expect(file.statements.length).toBe(1);
    expect(file.statements.every((s) => ts.isVariableStatement(s))).toBe(true);
  });
});
