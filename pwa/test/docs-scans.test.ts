// Source scans over the Docs screen's own code (native Docs reader, W5; spec 2026-10-01 4.15). Each clause reads
// files with TypeScript's full parser (`ts.createSourceFile` and a walk of its syntax tree), never a regular
// expression, so a comment, a string or a template that merely spells a form is not a read (lesson 8).
//
// Clause 1, M4.T7's base form ("one badge function"; W5 part 1 Task 10): no file under `pwa/src/docs`, nor
// `pwa/src/screens/DocsScreen.tsx`, reads a draft's `state`. Every draft word a page shows comes from L0's
// `entryView` (its `opens`, `badge` and `withheld`) through `ENTRY_BADGE_TEXT` and `WITHHELD_SENTENCE`, so the row and
// the leaf cannot disagree. The walk finds a `state` member read off a `draft` member: `x.draft.state`,
// `x?.draft?.state`, `x['draft'].state`, `x.draft['state']`, through parentheses, `!`, `as` and `satisfies`; and the
// destructuring forms `const { state } = x.draft` and `const { draft: { state } } = x`.
// NOT EXHAUSTIVE. Known evasions it does not see: a draft held in a variable first (`const d = x.draft; d.state`), a
// key held in a variable (`x.draft[key]`), a parameter typed as the draft (`(d: Draft) => d.state`), assignment
// destructuring (`({ state } = x.draft)`), `Object.entries` / `Object.values` / a spread over a draft, and anything
// reached through `any`. Review lens 4 reads for those, and docs-truth.test.tsx's row/leaf equality case catches a
// second badge whatever its spelling.
//
// W5 part 2 appends its clauses (M4.SH7, M4.EX2, M4.EX11, M4.EX16) below this one.
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { afterAll, describe, expect, it } from 'vitest';

const PWA = path.join(import.meta.dirname, '..');
const DOCS_DIR = path.join(PWA, 'src', 'docs');
const DOCS_SCREEN = path.join(PWA, 'src', 'screens', 'DocsScreen.tsx');

/** Every `.ts` and `.tsx` file at `root` (a file) or under it (a directory), sorted. */
function sourceFiles(root: string): string[] {
  if (statSync(root).isFile()) return [root];
  const out: string[] = [];
  for (const name of readdirSync(root).sort()) {
    const p = path.join(root, name);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

/** An expression with its parentheses, `!`, `as`, `satisfies` and `<T>` casts taken off. */
function unwrap(n: ts.Expression): ts.Expression {
  let e = n;
  while (ts.isParenthesizedExpression(e) || ts.isNonNullExpression(e) || ts.isAsExpression(e)
    || ts.isSatisfiesExpression(e) || ts.isTypeAssertionExpression(e)) e = e.expression;
  return e;
}

/** The member an access reads (`x.name`, `x?.name`, `x['name']`); undefined for a key the parser cannot name. */
function memberName(n: ts.Node): string | undefined {
  if (ts.isPropertyAccessExpression(n)) return n.name.text;
  if (ts.isElementAccessExpression(n)) {
    const a = n.argumentExpression;
    if (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a)) return a.text;
  }
  return undefined;
}

/** The property a binding element takes (`{ state }`, `{ state: s }`, `{ 'state': s }`). */
function bindingKey(el: ts.BindingElement): string | undefined {
  const key = el.propertyName ?? el.name;
  if (ts.isIdentifier(key) || ts.isStringLiteral(key)) return key.text;
  return undefined;
}

/** Whether an object binding pattern destructures a draft: `= x.draft`, or nested under a `draft` key. */
function bindsDraft(pattern: ts.ObjectBindingPattern): boolean {
  const parent = pattern.parent;
  if (ts.isVariableDeclaration(parent)) {
    return parent.initializer !== undefined && memberName(unwrap(parent.initializer)) === 'draft';
  }
  return ts.isBindingElement(parent) && bindingKey(parent) === 'draft';
}

/** Every read of a draft's `state` in one module, as `<file>:<line>:<column>`. */
function draftStateReads(source: string, fileName: string): string[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const hits: string[] = [];
  const at = (n: ts.Node): void => {
    const { line, character } = sf.getLineAndCharacterOfPosition(n.getStart(sf));
    hits.push(`${fileName}:${line + 1}:${character + 1}`);
  };
  const visit = (n: ts.Node): void => {
    if ((ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n)) && memberName(n) === 'state'
      && memberName(unwrap(n.expression)) === 'draft') at(n);
    if (ts.isObjectBindingPattern(n) && bindsDraft(n)) {
      for (const el of n.elements) if (bindingKey(el) === 'state') at(el);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return hits;
}

/** The scan over a tree: every hit in every source file under `roots`, named relative to `base`. */
function scanTree(roots: readonly string[], base: string): { files: string[]; hits: string[] } {
  const files = roots.flatMap(sourceFiles);
  const hits = files.flatMap((f) => draftStateReads(readFileSync(f, 'utf8'), path.relative(base, f)));
  return { files: files.map((f) => path.relative(base, f)), hits };
}

describe("clause 1: no Docs file reads a draft's state (M4.T7, base form)", () => {
  it.each([
    ['e.draft.state', "export const f = (e: E) => e.draft.state;"],
    ['e.draft?.state', "export const f = (e: E) => e.draft?.state;"],
    ['e?.draft?.state', "export const f = (e?: E) => e?.draft?.state;"],
    ["e['draft'].state", "export const f = (e: E) => e['draft'].state;"],
    ["e.draft['state']", "export const f = (e: E) => e.draft['state'];"],
    ["e['draft']['state']", "export const f = (e: E) => e['draft']['state'];"],
    ['(e.draft).state', "export const f = (e: E) => (e.draft).state;"],
    ['e.draft!.state', "export const f = (e: E) => e.draft!.state;"],
    ['(e.draft as D).state', "export const f = (e: E) => (e.draft as D).state;"],
    ['const { state } = e.draft', "export function f(e: E) { const { state } = e.draft; return state; }"],
    ['const { state: s } = e.draft!', "export function f(e: E) { const { state: s } = e.draft!; return s; }"],
    ['const { draft: { state } } = e', "export function f(e: E) { const { draft: { state } } = e; return state; }"],
    ['a JSX expression', "export const F = (p: P) => <span>{p.e.draft.state === 'deleted' ? 'x' : 'y'}</span>;"],
  ])('finds %s', (_name, source) => {
    expect(draftStateReads(source, 'planted.tsx')).toHaveLength(1);
  });

  it.each([
    ['a DraftsFacts state', 'export const f = (t: T) => t.drafts.state;'],
    ["a draft's other field", 'export const f = (e: E) => e.draft?.size;'],
    ['a state off something else', "export const f = (r: R) => r.state === 'ready';"],
    ['a comment', '// e.draft.state is never read\nexport const x = 1;'],
    ['a string', "export const x = 'e.draft.state';"],
  ])('does not count %s', (_name, source) => {
    expect(draftStateReads(source, 'planted.ts')).toEqual([]);
  });

  it.each([
    ['a variable holding the draft', 'export function f(e: E) { const d = e.draft; return d?.state; }'],
    ['a computed key', 'export const f = (e: E, k: K) => e.draft[k];'],
    ['a parameter typed as the draft', 'export const f = (d: Draft) => d.state;'],
  ])('known evasion, not seen (the header says not exhaustive): %s', (_name, source) => {
    expect(draftStateReads(source, 'planted.ts')).toEqual([]);
  });

  it('the Docs screen code reads no draft state', () => {
    const { files, hits } = scanTree([DOCS_DIR, DOCS_SCREEN], PWA);
    expect(files).toEqual(expect.arrayContaining([
      'src/docs/DocsHead.tsx', 'src/docs/DocsBanners.tsx', 'src/docs/DocsTreeView.tsx', 'src/docs/docsLinks.ts',
      'src/screens/DocsScreen.tsx',
    ]));
    expect(hits).toEqual([]);
  });

  describe('a planted control in a copy of the tree', () => {
    const copy = mkdtempSync(path.join(os.tmpdir(), 'docs-scans-'));
    afterAll(() => rmSync(copy, { recursive: true, force: true }));

    it('a file planted beside the real ones is found, by file and line', () => {
      const docs = path.join(copy, 'src', 'docs');
      cpSync(DOCS_DIR, docs, { recursive: true });
      writeFileSync(path.join(docs, 'Planted.tsx'),
        "import type { DocsEntry } from '../../../shared/docs';\n"
        + "export const word = (e: DocsEntry): string | undefined => e.draft?.state;\n");
      expect(scanTree([docs], copy).hits).toEqual(['src/docs/Planted.tsx:2:59']);
    });
  });
});
