// Every PWA render limit (native Docs reader, W4 Task 3; design 2026-10-01 section 4.9's table): each value pinned,
// and each name declared exactly once, in `src/lib/markdownLimits.ts`, across `pwa/src` and `shared`.
// `DOCS_PARSE_BUDGET_MS` is a formula of a byte count; its points are M4.P6's, in `markdown-runner.test.ts`.
//
// The declared-once scan reads declarations through TypeScript's own parser: a `const`/`let`/`var` (a destructured
// binding and a `declare const` included), a function, a class, an enum, an interface or a type alias named like a
// limit counts as a declaration. Known evasions, NOT EXHAUSTIVE: an object property or enum member with the name,
// a parameter, an import renamed to it, and the value spelled under any other name (a bare `4096`) are not
// declarations of the name and are not seen here.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import * as limits from '../src/lib/markdownLimits';

const VALUES: Readonly<Record<string, number>> = {
  MD_MAX_CONTAINER_DEPTH: 32,
  MD_MAX_DELIMITER_RUN: 64,
  MD_MAX_TREE_DEPTH: 64,
  DOCS_MAX_RENDER_ELEMENTS: 20000,
  MD_HIGHLIGHT_BLOCK_MAX_CHARS: 65536,
  DOCS_HIGHLIGHT_PAGE_MAX_CHARS: 524288,
  DOCS_PARSE_BUDGET_LARGE_MS: 30000,
  DOCS_RENDER_GATE_BYTES: 524288,
  CHAT_SYNC_MAX_BYTES: 4096,
  CHAT_PARSE_BUDGET_MS: 2000,
  MD_HIGHLIGHT_MAX_WORD_CHARS: 256,
  MD_HIGHLIGHT_MAX_LINE_CHARS: 2048,
  MD_HIGHLIGHT_MAX_BLANK_CHARS: 2048,
  MD_KEYSTROKE_MAX_CHARS: 64,
};
const NAMES: readonly string[] = [...Object.keys(VALUES), 'DOCS_PARSE_BUDGET_MS'].sort();

describe('markdownLimits: the values of section 4.9', () => {
  it.each(Object.entries(VALUES))('%s is %d', (name, value) => {
    expect((limits as Record<string, unknown>)[name]).toBe(value);
  });

  it('DOCS_PARSE_BUDGET_MS is a function of a byte count', () => {
    expect(typeof limits.DOCS_PARSE_BUDGET_MS).toBe('function');
  });

  it('exports exactly the fifteen limits', () => {
    expect(Object.keys(limits).sort()).toEqual(NAMES);
  });
});

const PWA = path.join(import.meta.dirname, '..');
const REPO = path.join(PWA, '..');
const SCAN_ROOTS = [path.join(PWA, 'src'), path.join(REPO, 'shared')];

/** Every `.ts`/`.tsx` file under `dir`, by an explicit-stack walk. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  const dirs = [dir];
  while (dirs.length > 0) {
    const d = dirs.pop()!;
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name !== 'node_modules') dirs.push(p);
      } else if (e.isFile() && /\.tsx?$/.test(e.name)) out.push(p);
    }
  }
  return out;
}

/** The names a binding declares: an identifier, or every identifier inside a destructuring pattern. */
function boundNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text];
  const out: string[] = [];
  for (const el of name.elements) if (!ts.isOmittedExpression(el)) out.push(...boundNames(el.name));
  return out;
}

/** Every name `file` declares at any depth, through TypeScript's parser. */
function declaredNames(file: string): string[] {
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, false, kind);
  const out: string[] = [];
  const stack: ts.Node[] = [sf];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (ts.isVariableDeclaration(node)) out.push(...boundNames(node.name));
    else if (
      (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isEnumDeclaration(node)
        || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node))
      && node.name !== undefined
    ) out.push(node.name.text);
    ts.forEachChild(node, (child) => {
      stack.push(child);
    });
  }
  return out;
}

describe('markdownLimits: each limit is declared once, in lib/markdownLimits.ts', () => {
  const files = SCAN_ROOTS.flatMap(sourceFiles);
  const holders = new Map<string, string[]>(NAMES.map((n) => [n, []]));
  for (const file of files) {
    for (const name of declaredNames(file)) holders.get(name)?.push(path.relative(REPO, file).split(path.sep).join('/'));
  }

  it('reads both roots', () => {
    expect(files.some((f) => f.includes(`${path.sep}shared${path.sep}`))).toBe(true);
    expect(files.length).toBeGreaterThan(100);
  });

  it.each(NAMES)('%s has exactly one declaration, in pwa/src/lib/markdownLimits.ts', (name) => {
    expect(holders.get(name)).toEqual(['pwa/src/lib/markdownLimits.ts']);
  });
});
