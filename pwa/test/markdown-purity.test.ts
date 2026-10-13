// The parse worker's first-party import closure stays pure (native Docs reader, W4 Task 3; design 2026-10-01 section
// 4.10 and the W4 plan's ring rule): starting from the worker-side roots, every first-party file the closure reaches
// imports only other closure files, `unified`, `remark-parse`, `remark-gfm`, `remark-rehype` and the types-only `hast`
// and `mdast`. So no first-party import brings React, react-dom, highlight.js, `../session/*`, `./api` or a stylesheet
// to the worker. The walk stops at those package names: what the allowed packages import in turn, and which entry
// of theirs the bundler picks by export condition, are not read here. That is how the DOM reached the built worker
// once (`decode-named-character-reference`'s `browser` entry, review 408's F1) while this scan stayed green; the
// guarantee for the built artefact is `markdown-worker-built.test.ts`, which loads the emitted chunk with no DOM.
// Specifiers are read from TypeScript's full parser (`ts.createSourceFile` and a walk of its tree), not by a regex and
// not by `ts.preProcessFile`, whose scanner misses `export * as ns from` and loses every import after a regex literal
// that holds a backtick. The walk takes every `import` and `export ... from` (`import type` included), `import x =
// require()`, `import('x')` type, `import()` call and `require()` call. An `import()` or `require()` whose argument is
// not a string literal, and any `import.meta.glob`, cannot be proved pure, so each is itself a violation, reported by
// file, line and column. `hast` and `mdast` have no runtime module (their only package is `@types/*`), so naming
// them can only ever be a type import. ROOTS end at `markdownWorker.ts`, the entry.
//
// The scan is not exhaustive. It reads first-party module specifiers only: a DOM global used without an import
// (`window`, `document`), `eval`, `new Function`, `importScripts`, a `require` reached through an alias, a worker or
// asset URL built with `new URL(..., import.meta.url)` and a file the closure does not resolve are not seen here, and
// the worker, which has no DOM, is where such a use would fail.
//
// The five direct dependencies the closure rests on are pinned exactly, in `package.json` and in the lock's root.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const PWA = path.join(import.meta.dirname, '..');
const LIB = path.join(PWA, 'src', 'lib');
const ROOTS: readonly string[] = [
  'markdownLimits.ts', 'markdownGuard.ts', 'remarkAlerts.ts', 'markdownParse.ts', 'markdownWorker.ts',
];
const ALLOWED_PACKAGES: ReadonlySet<string> = new Set([
  'unified', 'remark-parse', 'remark-gfm', 'remark-rehype', 'hast', 'mdast',
]);

/** The file a relative specifier names, or `undefined` when no `.ts`/`.tsx` file answers it. */
function resolveRelative(from: string, spec: string): string | undefined {
  const base = path.resolve(path.dirname(from), spec);
  return [`${base}.ts`, `${base}.tsx`, base, path.join(base, 'index.ts')]
    .find((p) => /\.tsx?$/.test(p) && existsSync(p));
}

/** What one module's source names: every specifier it loads, and every use it cannot prove pure. */
interface ModuleScan {
  specs: string[];
  unprovable: string[];
}

const GLOB_NAMES: ReadonlySet<string> = new Set(['glob', 'globEager']);

/**
 * Reads one module with TypeScript's full parser and walks every node: each `import` and `export ... from`
 * specifier (`export * as ns from` and `import type` included), `import x = require()`, `import('x')` types, and every
 * `import()` and `require()` call. A call whose argument is not a string literal, and any `import.meta.glob`, cannot be
 * proved pure, so each is reported under its line and column in `unprovable`.
 */
function scanModule(source: string, fileName: string): ModuleScan {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, false,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const specs: string[] = [];
  const unprovable: string[] = [];
  const literal = (n: ts.Node | undefined): string | undefined =>
    n !== undefined && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) ? n.text : undefined;
  const refuse = (n: ts.Node, what: string): void => {
    const { line, character } = sf.getLineAndCharacterOfPosition(n.getStart(sf));
    unprovable.push(`${line + 1}:${character + 1}: ${what}`);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const spec = literal(node.moduleSpecifier);
      if (spec !== undefined) specs.push(spec);
    } else if (ts.isImportEqualsDeclaration(node)) {
      if (ts.isExternalModuleReference(node.moduleReference)) {
        const spec = literal(node.moduleReference.expression);
        if (spec !== undefined) specs.push(spec);
      }
    } else if (ts.isImportTypeNode(node)) {
      const spec = ts.isLiteralTypeNode(node.argument) ? literal(node.argument.literal) : undefined;
      if (spec !== undefined) specs.push(spec);
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const kind = callee.kind === ts.SyntaxKind.ImportKeyword ? 'import()'
        : ts.isIdentifier(callee) && callee.text === 'require' ? 'require()' : undefined;
      if (kind !== undefined) {
        const spec = literal(node.arguments[0]);
        if (spec !== undefined) specs.push(spec);
        else refuse(node, `${kind} with an argument that is not a string literal`);
      }
    } else if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const base = node.expression;
      const member = ts.isPropertyAccessExpression(node) ? node.name.text : literal(node.argumentExpression);
      if (ts.isMetaProperty(base) && base.keywordToken === ts.SyntaxKind.ImportKeyword
        && member !== undefined && GLOB_NAMES.has(member)) refuse(node, `import.meta.${member}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { specs, unprovable };
}

/**
 * Walks the closure from ROOTS: the files reached, and every specifier that is neither a closure file nor allowed.
 * `read` answers a file's source (the real file by default; a case passes a reader that appends to one).
 */
function closure(read: (file: string) => string = (f) => readFileSync(f, 'utf8')): { files: string[]; refused: string[] } {
  const seen = new Set<string>();
  const refused: string[] = [];
  const todo = ROOTS.map((r) => path.join(LIB, r));
  while (todo.length > 0) {
    const file = todo.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const rel = path.relative(PWA, file).split(path.sep).join('/');
    const scan = scanModule(read(file), file);
    for (const u of scan.unprovable) refused.push(`${rel}:${u}`);
    for (const spec of scan.specs) {
      if (spec.startsWith('.')) {
        const target = resolveRelative(file, spec);
        if (target === undefined) refused.push(`${rel}: ${spec}`);
        else todo.push(target);
      } else if (!ALLOWED_PACKAGES.has(spec)) refused.push(`${rel}: ${spec}`);
    }
  }
  return { files: [...seen].map((f) => path.relative(PWA, f).split(path.sep).join('/')).sort(), refused };
}

describe('the parse worker closure', () => {
  const { files, refused } = closure();

  it('is exactly the worker-side lib files', () => {
    expect(files).toEqual(ROOTS.map((r) => `src/lib/${r}`).sort());
  });

  it('imports nothing outside the closure but unified, the three remark plugins and the hast/mdast types', () => {
    expect(refused).toEqual([]);
  });
});

const PINS: Readonly<Record<string, string>> = {
  'hast-util-to-jsx-runtime': '2.3.6',
  'html-url-attributes': '3.0.1',
  'remark-parse': '11.0.0',
  'remark-rehype': '11.1.2',
  unified: '11.0.5',
};

describe('the five direct dependencies are pinned exactly', () => {
  const pkg = JSON.parse(readFileSync(path.join(PWA, 'package.json'), 'utf8')) as {
    dependencies: Record<string, string>;
  };
  const lock = JSON.parse(readFileSync(path.join(PWA, 'package-lock.json'), 'utf8')) as {
    packages: Record<string, { version?: string; dependencies?: Record<string, string> }>;
  };

  it.each(Object.entries(PINS))('%s is %s in package.json, in the lock root, and installed at it', (name, version) => {
    expect(pkg.dependencies[name]).toBe(version);
    expect(lock.packages['']?.dependencies?.[name]).toBe(version);
    expect(lock.packages[`node_modules/${name}`]?.version).toBe(version);
  });
});

/** A reader that returns each file as it is, with `text` added to the end of the one lib file named `name`. */
const appendTo = (name: string, text: string) => (file: string): string => {
  const real = readFileSync(file, 'utf8');
  return file === path.join(LIB, name) ? `${real}\n${text}\n` : real;
};

describe('T11 review 1-1: the scan reads every re-export form, `export * as ns from` included', () => {
  it.each([
    ["export * as R from 'react';", 'react'],
    ["export * from 'react';", 'react'],
    ["export { a } from 'react';", 'react'],
    ["export type { A } from 'react';", 'react'],
    ["export * as ns from './markdownLimits';", './markdownLimits'],
    ["import type { A } from 'hast';", 'hast'],
    ["import * as R from 'react';", 'react'],
    ["import 'highlight.js/lib/core';", 'highlight.js/lib/core'],
  ])('%s names %s', (src, spec) => {
    expect(scanModule(src, 'fixture.ts').specs).toEqual([spec]);
  });

  it('refuses a namespace re-export of highlight.js and walks into a re-exported session component', () => {
    const { files, refused } = closure(appendTo('markdownLimits.ts', [
      "export * as HighlightInWorker from 'highlight.js/lib/core';",
      "export * as BubbleInWorker from '../session/MessageBubble';",
    ].join('\n')));
    expect(refused).toContain('src/lib/markdownLimits.ts: highlight.js/lib/core');
    expect(files).toContain('src/session/MessageBubble.tsx');
    expect(refused).toContain('src/session/MessageBubble.tsx: react');
  });
});

describe('T11 review 1-2: a regex literal holding a backtick hides no import that follows it', () => {
  it.each([
    ["const BT = /`/;\nimport React from 'react';", ['react']],
    ["const BT = /`/;\nexport const f = () => import('react');", ['react']],
    ["const BT = /`+/g;\nexport * as H from 'highlight.js';\nconst r = require('react');", ['highlight.js', 'react']],
  ])('%j names %j', (src, specs) => {
    expect(scanModule(src, 'fixture.ts').specs).toEqual(specs);
  });

  it('refuses react imported after a backtick regex in a closure file', () => {
    const { refused } = closure(appendTo('remarkAlerts.ts', [
      'const BACKTICK = /`/;',
      'export const backtickSource = BACKTICK.source;',
      "import { createElement } from 'react';",
      'export const ce = createElement;',
    ].join('\n')));
    expect(refused).toContain('src/lib/remarkAlerts.ts: react');
  });
});

describe('T11 review 1-3: an import() or require() that cannot be proved pure, and import.meta.glob, are violations', () => {
  it.each([
    ["const n = 'react';\nexport const d = () => import(n);", /^2:\d+: import\(\) with an argument that is not a string literal$/],
    ['export const d = (x: string) => import(`react-${x}`);', /^1:\d+: import\(\) with an argument that is not a string literal$/],
    ['export const d = () => import();', /^1:\d+: import\(\) with an argument that is not a string literal$/],
    ["const n = 'react';\nconst r = require(n);", /^2:\d+: require\(\) with an argument that is not a string literal$/],
    ["export const g = import.meta.glob('../session/*.tsx', { eager: true });", /^1:\d+: import\.meta\.glob$/],
    ["export const g = import.meta['globEager']('../session/*.tsx');", /^1:\d+: import\.meta\.globEager$/],
  ])('%j is reported once, by position', (src, report) => {
    const scan = scanModule(src, 'fixture.ts');
    expect(scan.unprovable).toHaveLength(1);
    expect(scan.unprovable[0]).toMatch(report);
    expect(scan.specs).toEqual([]);
  });

  it.each([
    ["export const d = () => import('react');", 'react'],
    ['export const d = () => import(`react`);', 'react'],
    ["const r = require('react');", 'react'],
    ["import r = require('react');", 'react'],
    ["export type T = import('react').FC;", 'react'],
  ])('%j names %s and is not reported', (src, spec) => {
    const scan = scanModule(src, 'fixture.ts');
    expect(scan.specs).toEqual([spec]);
    expect(scan.unprovable).toEqual([]);
  });

  it('does not report the other import.meta members', () => {
    const scan = scanModule("export const u = import.meta.url + import.meta.env.MODE + import.meta['hot'];", 'fixture.ts');
    expect(scan).toEqual({ specs: [], unprovable: [] });
  });

  it('refuses a glob and a variable import() appended to a closure file, each under file, line and column', () => {
    const { refused } = closure(appendTo('markdownGuard.ts', [
      "export const __g = import.meta.glob('../session/*.tsx', { eager: true });",
      "const __n = 'react';",
      'export const __d = () => import(__n);',
    ].join('\n')));
    const here = refused.filter((r) => r.startsWith('src/lib/markdownGuard.ts:'));
    expect(here).toHaveLength(2);
    expect(here[0]).toMatch(/^src\/lib\/markdownGuard\.ts:\d+:\d+: import\.meta\.glob$/);
    expect(here[1]).toMatch(/^src\/lib\/markdownGuard\.ts:\d+:\d+: import\(\) with an argument that is not a string literal$/);
  });
});
