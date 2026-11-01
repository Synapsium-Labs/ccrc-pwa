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
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
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

// ---------------------------------------------------------------------------------------------------------------
// Clause W8a (native Docs reader, wave 8a; amended M8.10 and M8.21's main-thread rule; spec rows A2b, A9, M8.10, M8.21).
// The shared Markdown library's entry points have exactly the homes below, and the reader's port, frame and frame
// policy live in the library, never in `pwa/src/docs`. The same walk finds, across `pwa/src`: a value import of the
// worker-side render job outside the worker entry (the library's `render()` runs only through `docsRunner`, off the
// main thread), a `message` listener added with `addEventListener`, and a `window.onmessage` / `self.onmessage`
// assignment outside the parse worker's own files.
//   Library specifiers (an import or export declaration, a literal dynamic `import()`, an `import('x').T` type, an
//   `import x = require('x')`) have these homes, exactly: `/host` in `docs/reader/bridge.ts`; `/render` in
//   `lib/readerRenderJob.ts`; `/assets/…?raw` in `docs/reader/assets.ts`; `/frame` under `docs/reader/`; the bare
//   package, `/enhance`, `/highlight`, `/conformance` and every other subpath nowhere.
//   In `pwa/src/docs`: no `postMessage` call, no `MessageChannel` identifier, no `onmessage` member, no JSX `iframe`
//   element, no `srcDoc` / `srcdoc` JSX attribute or string, no `default-src 'none'` string; except Export's two
//   allowances, by exact path (A2b, M8.10): the `iframe` element and `srcDoc` in `docs/export/buildExport.tsx`, and
//   `default-src 'none'` in `docs/export/policy.ts`. The allowance holds whether or not those files exist yet.
// NOT EXHAUSTIVE. Known evasions it does not see: a specifier built at run time (`import(name)`, a template with a
// substitution), `eval` and `new Function`, a re-export through a file outside `pwa/src`, a `message` listener added
// through a variable holding the event name (`addEventListener(type, …)`) or through an alias of the global scope
// (`const w = window; w.onmessage = …`), an `iframe` made with `createElement('iframe')` or a computed tag, a
// `srcdoc` attribute set through `setAttribute` with a built name, and a `default-src` string assembled from
// pieces. Review lens 4 reads for those; the library's own frame tests and `reader-bridge.test.ts` hold the runtime
// side.
// ---------------------------------------------------------------------------------------------------------------
const SRC_DIR = path.join(PWA, 'src');
const LIBRARY = '@synapsium-labs/docserver';
/** The worker-side render job, as a base-relative path without its extension. */
const RENDER_JOB = 'src/lib/readerRenderJob';

/** One finding: the file (relative to the scanned base, `/` separators), where, and which rule. */
interface ReaderHit { file: string; at: string; rule: string }

/** The homes of the library's entry points: a subpath predicate and the predicate of the files that may use it. */
const LIBRARY_HOMES: ReadonlyArray<readonly [(sub: string) => boolean, (file: string) => boolean]> = [
  [(sub) => sub === '/host', (file) => file === 'src/docs/reader/bridge.ts'],
  [(sub) => sub === '/render', (file) => file === 'src/lib/readerRenderJob.ts'],
  [(sub) => /^\/assets\/.+\?raw$/.test(sub), (file) => file === 'src/docs/reader/assets.ts'],
  [(sub) => sub === '/frame', (file) => file.startsWith('src/docs/reader/')],
];

/** Where the message scan reads: all of `pwa/src`. */
const inMessageScope = (file: string): boolean => file.startsWith('src/');
/** The only files that may assign `window.onmessage` / `self.onmessage`: the parse workers' own entries. */
const MESSAGE_ASSIGN_HOMES: readonly string[] = ['src/lib/markdownWorker.ts', 'src/lib/markdownHighlightWorker.ts'];
/** The only file with a value import of the render job: the worker entry (M8.21). */
const renderJobValueHome = (file: string): boolean => file === 'src/lib/markdownWorker.ts';

/** Export's two allowances, by exact path (A2b, M8.10): the `iframe` element and `srcDoc`, and the `default-src 'none'` string. */
function exportAllows(kind: 'iframe' | 'policy', file: string): boolean {
  return file === (kind === 'iframe' ? 'src/docs/export/buildExport.tsx' : 'src/docs/export/policy.ts');
}

/** A module specifier an import, export or `import()` names; `value` is false for the type-only forms. */
interface ModuleUse { specifier: string; value: boolean; node: ts.Node }

const isPlainString = (n: ts.Node): n is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral =>
  ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n);

function moduleUses(sf: ts.SourceFile): ModuleUse[] {
  const out: ModuleUse[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
      out.push({ specifier: n.moduleSpecifier.text, value: n.importClause?.isTypeOnly !== true, node: n });
    } else if (ts.isExportDeclaration(n) && n.moduleSpecifier !== undefined && ts.isStringLiteral(n.moduleSpecifier)) {
      out.push({ specifier: n.moduleSpecifier.text, value: !n.isTypeOnly, node: n });
    } else if (ts.isImportEqualsDeclaration(n) && ts.isExternalModuleReference(n.moduleReference)
      && ts.isStringLiteral(n.moduleReference.expression)) {
      out.push({ specifier: n.moduleReference.expression.text, value: !n.isTypeOnly, node: n });
    } else if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword
      && n.arguments[0] !== undefined && isPlainString(n.arguments[0])) {
      out.push({ specifier: n.arguments[0].text, value: true, node: n });
    } else if (ts.isImportTypeNode(n) && ts.isLiteralTypeNode(n.argument) && ts.isStringLiteral(n.argument.literal)) {
      out.push({ specifier: n.argument.literal.text, value: false, node: n });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/** Whether a relative specifier, written in `file`, names the render job (query and extension set aside). */
function namesRenderJob(file: string, specifier: string): boolean {
  if (!specifier.startsWith('.')) return false;
  const bare = specifier.replace(/[?#].*$/, '').replace(/\.(?:[cm]?[jt]sx?)$/, '');
  return path.posix.normalize(path.posix.join(path.posix.dirname(file), bare)) === RENDER_JOB;
}

/** The text of every string-like piece of a node: a string, a template without substitutions, a template part. */
const stringText = (n: ts.Node): string | undefined =>
  (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n)
    || ts.isTemplateTail(n)) ? n.text : undefined;

/** Every finding and every library or render-job specifier use in one module. */
function scanReaderFile(source: string, file: string): { hits: ReaderHit[]; uses: string[] } {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const hits: ReaderHit[] = [];
  const uses: string[] = [];
  const hit = (n: ts.Node, rule: string): void => {
    const { line, character } = sf.getLineAndCharacterOfPosition(n.getStart(sf));
    hits.push({ file, at: `${file}:${line + 1}:${character + 1}`, rule });
  };

  for (const use of moduleUses(sf)) {
    if (use.specifier === LIBRARY || use.specifier.startsWith(`${LIBRARY}/`)) {
      uses.push(`${file} ${use.specifier}`);
      const sub = use.specifier.slice(LIBRARY.length);
      const home = LIBRARY_HOMES.find(([isSub]) => isSub(sub));
      if (home === undefined || !home[1](file)) hit(use.node, `library:${sub === '' ? '(bare)' : sub.replace(/^(\/[^/]+).*$/, '$1')}`);
    } else if (namesRenderJob(file, use.specifier)) {
      uses.push(`${file} ${use.specifier}`);
      if (use.value && !renderJobValueHome(file)) hit(use.node, 'render-job:value-import');
    }
  }

  const inDocs = file.startsWith('src/docs/');
  const visit = (n: ts.Node): void => {
    if (inDocs) {
      if (ts.isCallExpression(n)) {
        const callee = unwrap(n.expression);
        if ((ts.isIdentifier(callee) && callee.text === 'postMessage') || memberName(callee) === 'postMessage') hit(n, 'docs:postMessage');
      }
      if (ts.isIdentifier(n) && n.text === 'MessageChannel') hit(n, 'docs:MessageChannel');
      if ((ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n)) && memberName(n) === 'onmessage') hit(n, 'docs:onmessage');
      if ((ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) && ts.isIdentifier(n.tagName) && n.tagName.text === 'iframe'
        && !exportAllows('iframe', file)) hit(n, 'docs:iframe');
      if (ts.isJsxAttribute(n) && ts.isIdentifier(n.name) && n.name.text.toLowerCase() === 'srcdoc'
        && !exportAllows('iframe', file)) hit(n, 'docs:srcDoc');
      const text = stringText(n);
      if (text !== undefined) {
        if (/srcdoc/i.test(text) && !exportAllows('iframe', file)) hit(n, 'docs:srcDoc');
        if (/default-src\s+'none'/.test(text) && !exportAllows('policy', file)) hit(n, 'docs:default-src-none');
      }
    }
    if (inMessageScope(file)) {
      if (ts.isCallExpression(n) && memberName(unwrap(n.expression)) === 'addEventListener'
        && n.arguments[0] !== undefined && isPlainString(n.arguments[0]) && n.arguments[0].text === 'message') {
        hit(n, 'message:addEventListener');
      }
      if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        const target = unwrap(n.left);
        if (memberName(target) === 'onmessage' && (ts.isPropertyAccessExpression(target) || ts.isElementAccessExpression(target))) {
          const owner = unwrap(target.expression);
          if (ts.isIdentifier(owner) && ['window', 'self', 'globalThis'].includes(owner.text)
            && !MESSAGE_ASSIGN_HOMES.includes(file)) hit(n, 'message:onmessage');
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return { hits, uses };
}

/** The reader scan over every `.ts` and `.tsx` file under `<base>/src`, named relative to `base`. */
function readerScan(base: string): { files: string[]; hits: ReaderHit[]; uses: string[] } {
  const files = sourceFiles(path.join(base, 'src')).map((f) => path.relative(base, f).split(path.sep).join('/'));
  const found = files.map((rel) => scanReaderFile(readFileSync(path.join(base, ...rel.split('/')), 'utf8'), rel));
  return { files, hits: found.flatMap((f) => f.hits), uses: found.flatMap((f) => f.uses) };
}

describe('clause W8a: the reader library has its homes (M8.10 amended, M8.21)', () => {
  const copies: string[] = [];
  afterAll(() => {
    for (const dir of copies) rmSync(dir, { recursive: true, force: true });
  });

  /** A copy of `pwa/src` in a temporary directory (the scan reads the copy); returns the directory holding `src`. */
  function treeCopy(): string {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'docs-scans-'));
    copies.push(dir);
    cpSync(SRC_DIR, path.join(dir, 'src'), { recursive: true });
    return dir;
  }
  /** Appends `text` to a file of the copy, or creates it. */
  function plant(dir: string, rel: string, text: string): void {
    const file = path.join(dir, ...rel.split('/'));
    let old = '';
    try {
      old = readFileSync(file, 'utf8');
    } catch {
      // A new file: the copy holds nothing at that path.
    }
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, old + text);
  }
  const names = (hits: ReaderHit[], family: string): string[] => hits.filter((h) => h.rule.startsWith(family)).map((h) => `${h.file} ${h.rule}`);

  it('M8.10: library specifiers sit only in their homes', () => {
    const { files, hits, uses } = readerScan(PWA);
    expect(files).toEqual(expect.arrayContaining([
      'src/docs/reader/bridge.ts', 'src/docs/reader/assets.ts', 'src/lib/readerRenderJob.ts', 'src/docs/ReaderFrame.tsx',
    ]));
    // The homes are real: each entry point is imported where the rule says it lives, so the rule is not green for
    // want of anything to see.
    expect(uses).toEqual(expect.arrayContaining([
      'src/docs/reader/bridge.ts @synapsium-labs/docserver/host',
      'src/docs/reader/bridge.ts @synapsium-labs/docserver/frame',
      'src/lib/readerRenderJob.ts @synapsium-labs/docserver/render',
      'src/docs/reader/assets.ts @synapsium-labs/docserver/assets/frame/guard.js?raw',
    ]));
    expect(names(hits, 'library:')).toEqual([]);
  });

  it('M8.10: pwa/src/docs holds no port, frame or frame policy of its own', () => {
    const { files, hits } = readerScan(PWA);
    expect(files.filter((f) => f.startsWith('src/docs/')).length).toBeGreaterThan(20);
    expect(names(hits, 'docs:')).toEqual([]);
  });

  it('M8.10: pwa/src holds no window message listener', () => {
    const { files, hits } = readerScan(PWA);
    expect(files).toEqual(expect.arrayContaining(['src/lib/markdownWorker.ts', 'src/lib/router.ts']));
    expect(names(hits, 'message:')).toEqual([]);
  });

  it('M8.10 planted: a /host import in DocsLeaf is red', () => {
    const dir = treeCopy();
    plant(dir, 'src/docs/DocsLeaf.tsx', "\nimport { createHost } from '@synapsium-labs/docserver/host';\nvoid createHost;\n");
    expect(names(readerScan(dir).hits, 'library:')).toEqual(['src/docs/DocsLeaf.tsx library:/host']);
  });

  it('M8.10 planted: a /render import in DocsLeaf is red', () => {
    const dir = treeCopy();
    plant(dir, 'src/docs/DocsLeaf.tsx', "\nimport { render } from '@synapsium-labs/docserver/render';\nvoid render;\n");
    expect(names(readerScan(dir).hits, 'library:')).toEqual(['src/docs/DocsLeaf.tsx library:/render']);
  });

  it('M8.10 planted: a message listener in lib/router is red', () => {
    const dir = treeCopy();
    plant(dir, 'src/lib/router.ts', "\nwindow.addEventListener('message', () => undefined);\n");
    expect(names(readerScan(dir).hits, 'message:')).toEqual(['src/lib/router.ts message:addEventListener']);
  });

  it('M8.10 planted: a postMessage call in DocsLeaf is red', () => {
    const dir = treeCopy();
    plant(dir, 'src/docs/DocsLeaf.tsx', "\nwindow.parent.postMessage('x', '*');\n");
    expect(names(readerScan(dir).hits, 'docs:')).toEqual(['src/docs/DocsLeaf.tsx docs:postMessage']);
  });

  it('M8.10 planted: srcDoc and default-src none in DocsLeaf are red', () => {
    const dir = treeCopy();
    plant(dir, 'src/docs/DocsLeaf.tsx',
      "\nexport const PlantedFrame = () => <div srcDoc=\"x\" />;\nexport const PLANTED_POLICY = \"default-src 'none'\";\n");
    expect(names(readerScan(dir).hits, 'docs:')).toEqual([
      'src/docs/DocsLeaf.tsx docs:srcDoc', 'src/docs/DocsLeaf.tsx docs:default-src-none',
    ]);
  });

  it("M8.10: Export's iframe, srcDoc and policy are allowed at their exact paths", () => {
    const dir = treeCopy();
    plant(dir, 'src/docs/export/buildExport.tsx', "export const PlantedExport = () => <iframe srcDoc=\"x\" />;\n");
    plant(dir, 'src/docs/export/policy.ts', "export const PLANTED_EXPORT_POLICY = \"default-src 'none'\";\n");
    const { files, hits } = readerScan(dir);
    expect(files).toEqual(expect.arrayContaining(['src/docs/export/buildExport.tsx', 'src/docs/export/policy.ts']));
    expect(hits).toEqual([]);
  });

  it('M8.21: a value import of readerRenderJob sits only in the worker entry', () => {
    const { hits, uses } = readerScan(PWA);
    expect(uses).toEqual(expect.arrayContaining([
      'src/lib/markdownWorker.ts ./readerRenderJob',
      'src/lib/markdownRunner.ts ./readerRenderJob',
      'src/docs/ReaderFrame.tsx ../lib/readerRenderJob',
    ]));
    expect(names(hits, 'render-job:')).toEqual([]);
  });

  it('M8.21 planted: a value import of readerRenderJob in ReaderFrame is red', () => {
    const dir = treeCopy();
    plant(dir, 'src/docs/ReaderFrame.tsx', "\nimport { answerRenderJob } from '../lib/readerRenderJob';\nvoid answerRenderJob;\n");
    expect(names(readerScan(dir).hits, 'render-job:')).toEqual(['src/docs/ReaderFrame.tsx render-job:value-import']);
  });
});
