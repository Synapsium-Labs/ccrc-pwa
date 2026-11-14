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
import { ts } from '../../server/test/scan/parse';
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
  MD_KEYSTROKE_MAX_CHARS: 64,
  // W5h-a and W5h-b (base spec 4.9's W5h rows and "Two more"): seven values R19 measured (W5h-b), then two fixed ones,
  // then the highlight cache's two bounds, moved from markdown.tsx unchanged (the W5h-a plan's refinement (c)).
  HIGHLIGHT_BLOCK_DEADLINE_MS: 750,
  HIGHLIGHT_BOOT_BUDGET_MS: 2000,
  HIGHLIGHT_PAGE_WORKER_MS: 12000,
  HIGHLIGHT_PAGE_MAX_TIMEOUTS: 2,
  MD_HIGHLIGHT_MAX_HTML_CHARS: 1048576,
  DOCS_HIGHLIGHT_PAGE_HTML_MAX_CHARS: 2097152,
  HIGHLIGHT_STREAM_DEBOUNCE_MS: 150,
  HIGHLIGHT_LINE_RETRY_UNITS: 256,
  HIGHLIGHT_CACHE_MAX_ENTRIES: 256,
  HIGHLIGHT_CACHE_MAX_CHARS: 4000000,
};
const NAMES: readonly string[] = [...Object.keys(VALUES), 'DOCS_PARSE_BUDGET_MS'].sort();

describe('markdownLimits: the values of section 4.9', () => {
  it.each(Object.entries(VALUES))('%s is %d', (name, value) => {
    expect((limits as Record<string, unknown>)[name]).toBe(value);
  });

  it('DOCS_PARSE_BUDGET_MS is a function of a byte count', () => {
    expect(typeof limits.DOCS_PARSE_BUDGET_MS).toBe('function');
  });

  it('exports exactly the twenty-two limits', () => {
    expect(Object.keys(limits).sort()).toEqual(NAMES);
  });

  it('M4.H22: the page HTML cap admits M4.H2\'s eight 60 000-character blocks at 2.90 HTML characters a character, and two blocks at the per-block HTML cap', () => {
    expect(limits.DOCS_HIGHLIGHT_PAGE_HTML_MAX_CHARS).toBeGreaterThanOrEqual(Math.ceil(8 * 60000 * 2.9));
    expect(limits.DOCS_HIGHLIGHT_PAGE_HTML_MAX_CHARS).toBeGreaterThanOrEqual(2 * limits.MD_HIGHLIGHT_MAX_HTML_CHARS);
  });

  it('M4.H22: each measured value says so in its docstring', () => {
    const src = readFileSync(path.join(import.meta.dirname, '..', 'src', 'lib', 'markdownLimits.ts'), 'utf8');
    expect(src).not.toContain('PROVISIONAL');
    for (const name of ['HIGHLIGHT_BLOCK_DEADLINE_MS', 'HIGHLIGHT_BOOT_BUDGET_MS', 'HIGHLIGHT_PAGE_WORKER_MS',
      'HIGHLIGHT_PAGE_MAX_TIMEOUTS', 'MD_HIGHLIGHT_MAX_HTML_CHARS', 'DOCS_HIGHLIGHT_PAGE_HTML_MAX_CHARS',
      'HIGHLIGHT_STREAM_DEBOUNCE_MS']) {
      expect(src, name).toMatch(new RegExp(`/\\*\\* MEASURED \\(W5h-b, R19 of 2026-11-03\\)\\.(?:(?!\\*/)[^])*\\*/\\nexport const ${name} = `));
    }
  });

  // Section 7.8's retirement gate, as R19 measured it on the operator's phone on 2026-11-03: a real block, cold in its
  // grammar, takes at most the slowest cold block's 96.1 ms, plus the xml and css compiles typescript and javascript run
  // on first use (at most 14.3 and 26.4 ms, those grammars' largest blocks cold), plus the slowest warm block's 143.7 ms:
  // 280.5 ms, all R19's item 1. The operator's bound for one block's colours is 2 000 ms (the W5h-a plan's approval,
  // 2026-11-02). The deadline sits between the two.
  it('M4.H22: the block deadline sits between the slowest real block, cold, and the operator\'s per-block bound', () => {
    expect(limits.HIGHLIGHT_BLOCK_DEADLINE_MS).toBeGreaterThan(96.1 + 14.3 + 26.4 + 143.7);
    expect(limits.HIGHLIGHT_BLOCK_DEADLINE_MS).toBeLessThanOrEqual(2000);
  });

  it('M4.H22: Export\'s longest wait, section 4.10\'s sum at the measured values, is 18 750 ms', () => {
    expect(limits.HIGHLIGHT_PAGE_WORKER_MS + limits.HIGHLIGHT_BLOCK_DEADLINE_MS
      + (limits.HIGHLIGHT_PAGE_MAX_TIMEOUTS + 1) * limits.HIGHLIGHT_BOOT_BUDGET_MS).toBe(18750);
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

// Docs W5h-a Task 8 (base spec 2026-10-01 section 7.10's M4.H22, its mutation "a literal at a use site"): each new limit
// reaches its consumer by name, imported from `./markdownLimits`, and its value is not spelled as a number there. Read
// with TypeScript's parser. NOT EXHAUSTIVE: a value built from pieces, or spelled in a consumer not listed here, is not
// seen; the values 2 and 256 are too common to scan for, so `HIGHLIGHT_PAGE_MAX_TIMEOUTS`, `HIGHLIGHT_LINE_RETRY_UNITS`
// and `HIGHLIGHT_CACHE_MAX_ENTRIES` are checked by import only.
const USE_SITES: Readonly<Record<string, readonly string[]>> = {
  'markdownRunner.ts': ['HIGHLIGHT_BLOCK_DEADLINE_MS', 'HIGHLIGHT_BOOT_BUDGET_MS'],
  'highlightJob.ts': ['MD_HIGHLIGHT_MAX_HTML_CHARS', 'HIGHLIGHT_LINE_RETRY_UNITS', 'HIGHLIGHT_CACHE_MAX_ENTRIES', 'HIGHLIGHT_CACHE_MAX_CHARS'],
  'highlightStore.ts': [
    'HIGHLIGHT_PAGE_WORKER_MS', 'HIGHLIGHT_PAGE_MAX_TIMEOUTS', 'MD_HIGHLIGHT_MAX_HTML_CHARS',
    'DOCS_HIGHLIGHT_PAGE_HTML_MAX_CHARS', 'HIGHLIGHT_STREAM_DEBOUNCE_MS', 'HIGHLIGHT_LINE_RETRY_UNITS',
  ],
};

describe('M4.H22: the new limits reach their consumers by name (W5h-a)', () => {
  it.each(Object.entries(USE_SITES))('%s imports its limits from ./markdownLimits and spells none of their values', (file, names) => {
    const sf = ts.createSourceFile(file, readFileSync(path.join(PWA, 'src', 'lib', file), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const imported = new Set<string>();
    const numbers = new Set<number>();
    const visit = (n: ts.Node): void => {
      if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier) && n.moduleSpecifier.text === './markdownLimits'
        && n.importClause?.namedBindings !== undefined && ts.isNamedImports(n.importClause.namedBindings)) {
        for (const el of n.importClause.namedBindings.elements) imported.add(el.name.text);
      }
      if (ts.isNumericLiteral(n)) numbers.add(Number(n.text.replaceAll('_', '')));
      ts.forEachChild(n, visit);
    };
    visit(sf);
    for (const name of names) {
      expect(imported.has(name), `${file} imports ${name}`).toBe(true);
      const value = VALUES[name]!;
      if (value !== 2 && value !== 256) expect(numbers.has(value), `${file} spells ${name}'s value, ${value}`).toBe(false);
    }
  });
});
