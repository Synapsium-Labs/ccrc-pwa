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
//   element or string holding `<iframe`, no `srcdoc` (any case) identifier, property name, JSX attribute or string, no
//   `default-src 'none'` string (any case); except Export's two allowances, by exact path (A2b, M8.10): the `iframe`
//   and `srcDoc` forms in `docs/export/buildExport.tsx`, and `default-src 'none'` in `docs/export/policy.ts`. The
//   allowance holds whether or not those files exist yet.
//   Across `pwa/src`: `addEventListener('message', …)` as a member call or a bare call, and an assignment to
//   `window.onmessage`, `self.onmessage`, `globalThis.onmessage` or a bare `onmessage`, outside the parse workers'
//   own entries.
//   The main bundle (the "Library imports" constraint): `docs/reader/bridge` and `docs/reader/assets` reach it only
//   through `docs/ReaderFrame.tsx`'s two literal dynamic `import()` calls; any other value import of either, static
//   or dynamic, is red, save the bridge's own static import of the assets (the bridge loads lazily, so what it imports
//   is lazy with it). `import type` is allowed anywhere.
// NOT EXHAUSTIVE. Known evasions it does not see:
//   - a specifier string outside an import form is not a use: a specifier built at run time (`import(name)`, a
//     template with a substitution), `require`, `new URL(…, import.meta.url)`, `import.meta.glob`, `declare module`
//     and `/// <reference types>` are none of them uses; nor are `eval` and `new Function`;
//   - a re-export through a file outside `pwa/src`, and a relative path into the library's `dist` under
//     `node_modules` (that one is backstopped by docs-parity's M7.9 name check, which reds on the package's directory
//     name in `pwa/src`);
//   - a `message` listener added through a variable holding the event name (`addEventListener(type, …)`), or an
//     `onmessage` assigned through an alias of the global scope (`const w = window; w.onmessage = …`);
//   - a `postMessage` reached through `.call`, `.apply`, `.bind` or an alias (`const post = window.postMessage`);
//   - an `iframe` made with `createElement('iframe')` or a computed tag, a `srcdoc` attribute set through
//     `setAttribute` with a built name, and a `default-src` string assembled from pieces.
// Review lens 4 reads for those; the library's own frame tests and `reader-bridge.test.ts` hold the runtime side.
// ---------------------------------------------------------------------------------------------------------------
const SRC_DIR = path.join(PWA, 'src');
const LIBRARY = '@synapsium-labs/docserver';
/** The two value uses of the adapters that keep them out of the main bundle: ReaderFrame's literal dynamic `import()`s,
 * and the bridge's own static import of the assets (the bridge is itself loaded only through that dynamic import, so
 * what it imports is lazy with it). */
function adapterUseAllowed(file: string, target: string, dynamic: boolean): boolean {
  return (file === ADAPTER_LOADER && dynamic) || (file === 'src/docs/reader/bridge.ts' && target === 'src/docs/reader/assets');
}
/** The worker-side render job, as a base-relative path without its extension. */
const RENDER_JOB = 'src/lib/readerRenderJob';
/** The two reader adapters that must stay out of the main bundle, base-relative without an extension. */
const READER_ADAPTERS: readonly string[] = ['src/docs/reader/bridge', 'src/docs/reader/assets'];
/** The one file that may load them, and only as a literal dynamic `import()` (the "Library imports" constraint). */
const ADAPTER_LOADER = 'src/docs/ReaderFrame.tsx';

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
interface ModuleUse { specifier: string; value: boolean; dynamic: boolean; node: ts.Node }

const isPlainString = (n: ts.Node): n is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral =>
  ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n);

function moduleUses(sf: ts.SourceFile): ModuleUse[] {
  const out: ModuleUse[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
      out.push({ specifier: n.moduleSpecifier.text, value: n.importClause?.isTypeOnly !== true, dynamic: false, node: n });
    } else if (ts.isExportDeclaration(n) && n.moduleSpecifier !== undefined && ts.isStringLiteral(n.moduleSpecifier)) {
      out.push({ specifier: n.moduleSpecifier.text, value: !n.isTypeOnly, dynamic: false, node: n });
    } else if (ts.isImportEqualsDeclaration(n) && ts.isExternalModuleReference(n.moduleReference)
      && ts.isStringLiteral(n.moduleReference.expression)) {
      out.push({ specifier: n.moduleReference.expression.text, value: !n.isTypeOnly, dynamic: false, node: n });
    } else if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword
      && n.arguments[0] !== undefined && isPlainString(n.arguments[0])) {
      out.push({ specifier: n.arguments[0].text, value: true, dynamic: true, node: n });
    } else if (ts.isImportTypeNode(n) && ts.isLiteralTypeNode(n.argument) && ts.isStringLiteral(n.argument.literal)) {
      out.push({ specifier: n.argument.literal.text, value: false, dynamic: false, node: n });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/** The base-relative path (no extension) a relative specifier written in `file` names; undefined for a bare one. */
function relativeTarget(file: string, specifier: string): string | undefined {
  if (!specifier.startsWith('.')) return undefined;
  const bare = specifier.replace(/[?#].*$/, '').replace(/\.(?:[cm]?[jt]sx?)$/, '');
  return path.posix.normalize(path.posix.join(path.posix.dirname(file), bare));
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
    } else {
      const target = relativeTarget(file, use.specifier);
      if (target === RENDER_JOB) {
        uses.push(`${file} ${use.specifier}`);
        if (use.value && !renderJobValueHome(file)) hit(use.node, 'render-job:value-import');
      } else if (target !== undefined && READER_ADAPTERS.includes(target)) {
        uses.push(`${file} ${use.specifier}`);
        if (use.value && !adapterUseAllowed(file, target, use.dynamic)) hit(use.node, 'main-bundle:value-import');
      }
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
      // `srcdoc` in any case as a name: a JSX attribute, a member (`el.srcdoc =`), a property (`{ srcDoc: x }`).
      if (ts.isIdentifier(n) && n.text.toLowerCase() === 'srcdoc' && !exportAllows('iframe', file)) hit(n, 'docs:srcDoc');
      const text = stringText(n);
      if (text !== undefined) {
        if (/<iframe/i.test(text) && !exportAllows('iframe', file)) hit(n, 'docs:iframe');
        if (/srcdoc/i.test(text) && !exportAllows('iframe', file)) hit(n, 'docs:srcDoc');
        if (/default-src\s+'none'/i.test(text) && !exportAllows('policy', file)) hit(n, 'docs:default-src-none');
      }
    }
    if (inMessageScope(file)) {
      if (ts.isCallExpression(n) && n.arguments[0] !== undefined && isPlainString(n.arguments[0]) && n.arguments[0].text === 'message') {
        const callee = unwrap(n.expression);
        if ((ts.isIdentifier(callee) && callee.text === 'addEventListener') || memberName(callee) === 'addEventListener') {
          hit(n, 'message:addEventListener');
        }
      }
      if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && !MESSAGE_ASSIGN_HOMES.includes(file)) {
        const target = unwrap(n.left);
        if (ts.isIdentifier(target) && target.text === 'onmessage') {
          hit(n, 'message:onmessage');
        } else if ((ts.isPropertyAccessExpression(target) || ts.isElementAccessExpression(target)) && memberName(target) === 'onmessage') {
          const owner = unwrap(target.expression);
          if (ts.isIdentifier(owner) && ['window', 'self', 'globalThis'].includes(owner.text)) hit(n, 'message:onmessage');
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

  /** Plants `text` in one file of a fresh copy and returns every finding, as `<file> <rule>`. */
  function planted(rel: string, text: string): string[] {
    const dir = treeCopy();
    plant(dir, rel, text);
    return names(readerScan(dir).hits, '');
  }
  const LEAF = 'src/docs/DocsLeaf.tsx';
  const ROUTER = 'src/lib/router.ts';

  it('M8.10 planted: a bare addEventListener message listener in lib/router is red', () => {
    expect(planted(ROUTER, "\naddEventListener('message', () => undefined);\n")).toEqual([`${ROUTER} message:addEventListener`]);
  });

  it('M8.10 planted: a self.onmessage assignment in lib/router is red', () => {
    expect(planted(ROUTER, '\nself.onmessage = () => undefined;\n')).toEqual([`${ROUTER} message:onmessage`]);
  });

  it('M8.10 planted: a bare onmessage assignment in lib/router is red', () => {
    expect(planted(ROUTER, '\nonmessage = () => undefined;\n')).toEqual([`${ROUTER} message:onmessage`]);
  });

  it('M8.10 planted: a JSX iframe in DocsLeaf is red', () => {
    expect(planted(LEAF, '\nexport const PlantedIframe = () => <iframe />;\n')).toEqual([`${LEAF} docs:iframe`]);
  });

  it('M8.10 planted: a string holding an iframe tag in DocsLeaf is red', () => {
    expect(planted(LEAF, "\nexport const PLANTED_TAG = '<iframe sandbox>';\n")).toEqual([`${LEAF} docs:iframe`]);
  });

  it('M8.10 planted: a MessageChannel in DocsLeaf is red', () => {
    expect(planted(LEAF, '\nexport const planted = () => new MessageChannel();\n')).toEqual([`${LEAF} docs:MessageChannel`]);
  });

  it('M8.10 planted: an onmessage member in DocsLeaf is red', () => {
    expect(planted(LEAF, '\nexport const planted = (x: { onmessage: unknown }, f: () => void) => { x.onmessage = f; };\n'))
      .toEqual([`${LEAF} docs:onmessage`]);
  });

  it('M8.10 planted: a srcdoc string in DocsLeaf is red', () => {
    expect(planted(LEAF, "\nexport const PLANTED_KEY = 'srcdoc';\n")).toEqual([`${LEAF} docs:srcDoc`]);
  });

  it('M8.10 planted: srcdoc as a member name and as a property name in DocsLeaf is red', () => {
    expect(planted(LEAF, '\nexport const planted = (el: { x: string }, v: string) => { Reflect.set(el, "k", { srcDoc: v }); (el as never as { srcdoc: string }).srcdoc = v; };\n'))
      .toEqual([`${LEAF} docs:srcDoc`, `${LEAF} docs:srcDoc`, `${LEAF} docs:srcDoc`]);
  });

  it('M8.10 planted: an upper-case default-src none string in DocsLeaf is red', () => {
    expect(planted(LEAF, "\nexport const PLANTED_POLICY = \"DEFAULT-SRC 'NONE'\";\n")).toEqual([`${LEAF} docs:default-src-none`]);
  });

  it('M8.10 planted: the bare package import in DocsLeaf is red', () => {
    expect(planted(LEAF, "\nimport * as planted from '@synapsium-labs/docserver';\nvoid planted;\n")).toEqual([`${LEAF} library:(bare)`]);
  });

  it('M8.10 planted: an /enhance import in DocsLeaf is red', () => {
    expect(planted(LEAF, "\nimport * as planted from '@synapsium-labs/docserver/enhance';\nvoid planted;\n")).toEqual([`${LEAF} library:/enhance`]);
  });

  it('M8.10 planted: a /frame import in DocsLeaf is red', () => {
    expect(planted(LEAF, "\nimport { frameDocument } from '@synapsium-labs/docserver/frame';\nvoid frameDocument;\n"))
      .toEqual([`${LEAF} library:/frame`]);
  });

  it('M8.10 planted: an /assets raw import outside assets.ts is red', () => {
    expect(planted(LEAF, "\nimport planted from '@synapsium-labs/docserver/assets/frame/guard.js?raw';\nvoid planted;\n"))
      .toEqual([`${LEAF} library:/assets`]);
  });

  it("Library imports: the reader adapters reach the main bundle only through ReaderFrame's two dynamic imports", () => {
    const { hits, uses } = readerScan(PWA);
    const loader = (spec: string): string[] => uses.filter((u) => u === `src/docs/ReaderFrame.tsx ${spec}`);
    // The bridge is named twice there (an `import type` and the dynamic import), the assets once (the dynamic import).
    expect(loader('./reader/bridge')).toHaveLength(2);
    expect(loader('./reader/assets')).toHaveLength(1);
    expect(uses.filter((u) => /\/reader\/(?:bridge|assets)$/.test(u))).toHaveLength(3);
    expect(names(hits, 'main-bundle:')).toEqual([]);
  });

  it('Library imports planted: a static import of ./reader/bridge in DocsLeaf is red', () => {
    expect(planted(LEAF, "\nimport { mountReader } from './reader/bridge';\nvoid mountReader;\n")).toEqual([`${LEAF} main-bundle:value-import`]);
  });

  it('Library imports planted: a dynamic import of ./reader/assets in DocsLeaf is red', () => {
    expect(planted(LEAF, "\nexport const planted = () => import('./reader/assets');\n")).toEqual([`${LEAF} main-bundle:value-import`]);
  });

  it("Library imports planted: a static import of ./reader/bridge or ./reader/assets in ReaderFrame is red; a literal dynamic import there is the one allowed use", () => {
    const FRAME = 'src/docs/ReaderFrame.tsx';
    expect(planted(FRAME, "\nimport { mountReader as plantedMount } from './reader/bridge';\nvoid plantedMount;\n")).toEqual([`${FRAME} main-bundle:value-import`]);
    expect(planted(FRAME, "\nimport * as plantedAssets from './reader/assets';\nvoid plantedAssets;\n")).toEqual([`${FRAME} main-bundle:value-import`]);
    expect(planted(FRAME, "\nexport const plantedLoad = () => import('./reader/assets');\n")).toEqual([]);
  });

  it('Library imports planted: an import type of ./reader/bridge in DocsLeaf is allowed', () => {
    expect(planted(LEAF, "\nimport type { ReaderMount } from './reader/bridge';\nexport type PlantedMount = ReaderMount;\n")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Clause W5h-a (native Docs reader, W5h-a Task 8; base spec 2026-10-01 section 4.10's Guards; M4.H4, M4.H15's scan
// half, M4.H17's seam half, M7.11's literal count). Across `pwa/src` (and, for the first bullet's specifier half,
// `ui/src`, which pwa reaches through the `@/` alias), read with TypeScript's parser:
//   - a `highlight.js` specifier (any import or export form, `import()` and `import('x').T` included; matched as the
//     path segment `highlight.js` in the raw specifier and in a relative one's normalized target, so a path into
//     `node_modules` counts too) sits only in `lib/highlightGrammars.ts`, and nowhere in `ui/src`;
//     `lib/highlightGrammars` is imported only by `lib/highlightJob.ts`, `lib/highlightJob` only by
//     `lib/markdownHighlightWorker.ts`, and `lib/markdownHighlightWorker` by nothing (it is spawned by URL), so no
//     main-thread module reaches highlight.js (M4.H4; the built half is `markdown-worker-built.test.ts`'s);
//   - nothing imports a module under `pwa/test`, the test store above all (M4.H17);
//   - the NAME `dangerouslySetInnerHTML` appears in code only once: as the JSX attribute in `lib/markdown.tsx`'s
//     `HighlightedCode`, whose value is `{ __html: <name>.html }` for a `<name>` that function passes to
//     `isCheckedHighlightHtml` (M4.H15). Every other spelling is a hit: a JSX attribute, a property name (identifier,
//     string literal, template literal or computed, so a JSX spread or a props object given to `createElement`), a
//     shorthand property, an element-access argument, a property access. A comment is not code. Export's `<style>`
//     exception joins this clause, with its planted control, when Export lands;
//   - exactly one `new URL(<string ending in markdownHighlightWorker or markdownHighlightWorker.ts>)` in `pwa/src`,
//     in `markdownRunner.ts#spawnHighlightWorker`, in any quoting or line layout (M7.11).
// NOT EXHAUSTIVE. Known evasions: a specifier, a property name or a worker URL built at run time (concatenation, a
// template with a substitution, a variable); `require`, `eval`, or a re-export of highlight.js from outside `pwa/src`
// and `ui/src` (`shared/`); HTML written through the DOM (`innerHTML`, `outerHTML`, `insertAdjacentHTML`: none in
// `pwa/src`, which review lens 1 reads for); a checked value's `html` read through an alias before the sink. The
// behavioural halves are `highlight-html.test.tsx` (a forged value renders plain) and `highlight-wiring.test.tsx`
// (the context's default is production).
// ---------------------------------------------------------------------------------------------------------------

/** Each link of the highlight worker's chain, base-relative without an extension, and the one file that may import it
 *  (`null`: none may). */
const HIGHLIGHT_CHAIN: ReadonlyArray<readonly [string, string | null]> = [
  ['src/lib/highlightGrammars', 'src/lib/highlightJob.ts'],
  ['src/lib/highlightJob', 'src/lib/markdownHighlightWorker.ts'],
  ['src/lib/markdownHighlightWorker', null],
];
const HLJS_HOME = 'src/lib/highlightGrammars.ts';

/** The segment `highlight.js` in a path or a bare specifier: `highlight.js`, `highlight.js/lib/core`, a path into `node_modules`. */
const HLJS_SEGMENT = /(?:^|\/)highlight\.js(?:\/|$)/;

/** Whether a specifier written in `file` names highlight.js: as written, or as the path it resolves to when relative. */
function namesHighlightJs(file: string, specifier: string): boolean {
  if (HLJS_SEGMENT.test(specifier)) return true;
  return specifier.startsWith('.') && HLJS_SEGMENT.test(path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier)));
}

/** The name of the function declaration around a node, `(none)` when there is none. */
function enclosingFunction(n: ts.Node): ts.FunctionDeclaration | undefined {
  let fn: ts.Node | undefined = n.parent;
  while (fn !== undefined && !ts.isFunctionDeclaration(fn)) fn = fn.parent;
  return fn;
}
const functionName = (fn: ts.FunctionDeclaration | undefined): string => fn?.name?.text ?? '(none)';

const SINK_NAME = 'dangerouslySetInnerHTML';
const isSinkText = (n: ts.Node | undefined): boolean => n !== undefined && (ts.isIdentifier(n) || isPlainString(n)) && n.text === SINK_NAME;
/** Whether a property name (identifier, string, template, or computed over one) spells the sink's name. */
const isSinkPropertyName = (n: ts.PropertyName): boolean => ts.isComputedPropertyName(n) ? isSinkText(unwrap(n.expression)) : isSinkText(n);

/** Whether a node spells the sink's name in a position that names a property. */
function namesSink(n: ts.Node): boolean {
  if (ts.isJsxAttribute(n)) return isSinkText(n.name);
  if (ts.isPropertyAssignment(n) || ts.isShorthandPropertyAssignment(n) || ts.isMethodDeclaration(n)) return isSinkPropertyName(n.name);
  if (ts.isElementAccessExpression(n)) return isSinkText(unwrap(n.argumentExpression));
  if (ts.isPropertyAccessExpression(n)) return isSinkText(n.name);
  return false;
}

/** Where a sink is and whether it has the one allowed shape: `<file> <function> ok|bad`. */
function sinkVerdict(attr: ts.JsxAttribute, file: string): string {
  const fn = enclosingFunction(attr);
  const expr = attr.initializer !== undefined && ts.isJsxExpression(attr.initializer) ? attr.initializer.expression : undefined;
  let ok = false;
  if (fn !== undefined && expr !== undefined && ts.isObjectLiteralExpression(expr) && expr.properties.length === 1) {
    const prop = expr.properties[0]!;
    if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name) && prop.name.text === '__html'
      && ts.isPropertyAccessExpression(prop.initializer) && prop.initializer.name.text === 'html'
      && ts.isIdentifier(prop.initializer.expression)) {
      const held = prop.initializer.expression.text;
      const look = (n: ts.Node): void => {
        if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'isCheckedHighlightHtml'
          && n.arguments.length === 1 && ts.isIdentifier(n.arguments[0]!) && (n.arguments[0] as ts.Identifier).text === held) ok = true;
        ts.forEachChild(n, look);
      };
      look(fn);
    }
  }
  return `${file} ${functionName(fn)} ${ok ? 'ok' : 'bad'}`;
}

/** The highlight.js specifier hits in one module (`<file> highlight.js:import`), whichever the file's home. */
function highlightSpecifierHits(sf: ts.SourceFile, file: string): string[] {
  return moduleUses(sf).filter((use) => namesHighlightJs(file, use.specifier)).map(() => `${file} highlight.js:import`);
}

/** The findings in one module: its forbidden imports (`<file> <rule>`) and its sinks. */
function scanHighlightFile(source: string, file: string): { hits: string[]; sinks: string[] } {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const hits: string[] = file === HLJS_HOME ? [] : highlightSpecifierHits(sf, file);
  const sinks: string[] = [];
  for (const use of moduleUses(sf)) {
    if (namesHighlightJs(file, use.specifier)) continue;
    const target = relativeTarget(file, use.specifier);
    if (target === undefined) continue;
    if (target === 'test' || target.startsWith('test/')) hits.push(`${file} test:import`);
    for (const [module, home] of HIGHLIGHT_CHAIN) {
      if (target === module && file !== home) hits.push(`${file} ${module.slice('src/lib/'.length)}:import`);
    }
  }
  const visit = (n: ts.Node): void => {
    if (namesSink(n)) sinks.push(ts.isJsxAttribute(n) ? sinkVerdict(n, file) : `${file} ${functionName(enclosingFunction(n))} bad`);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return { hits, sinks };
}

/** Where `ui/src` is, which pwa reaches through the `@/` alias: no file there may name highlight.js. */
const UI_SRC_DIR = path.join(PWA, '..', 'ui', 'src');

/** The scan over every `.ts` and `.tsx` file under `<base>/src`, named relative to `base`, and over `uiSrc` (named `ui/src/...`). */
function highlightScan(base: string, uiSrc: string = UI_SRC_DIR): { files: string[]; hits: string[]; sinks: string[] } {
  const files = sourceFiles(path.join(base, 'src')).map((f) => path.relative(base, f).split(path.sep).join('/'));
  const found = files.map((rel) => scanHighlightFile(readFileSync(path.join(base, ...rel.split('/')), 'utf8'), rel));
  const uiHits = sourceFiles(uiSrc).flatMap((f) => {
    const rel = `ui/src/${path.relative(uiSrc, f).split(path.sep).join('/')}`;
    const sf = ts.createSourceFile(rel, readFileSync(f, 'utf8'), ts.ScriptTarget.Latest, true, f.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    return highlightSpecifierHits(sf, rel);
  });
  return { files, hits: [...found.flatMap((f) => f.hits), ...uiHits], sinks: found.flatMap((f) => f.sinks) };
}

/** The enclosing function of each `new URL(<string ending in markdownHighlightWorker[.ts]>)` in one module, `<file> <function>`. */
function highlightWorkerUrlSites(source: string, file: string): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const sites: string[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isNewExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'URL' && n.arguments?.[0] !== undefined
      && isPlainString(n.arguments[0]) && /markdownHighlightWorker(?:\.ts)?$/.test(n.arguments[0].text)) sites.push(`${file} ${functionName(enclosingFunction(n))}`);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return sites;
}

// Each planted case copies and re-scans the whole of pwa/src; under a loaded box that has passed vitest's 5 s default,
// so the clause gives its cases 30 s (a slow scan is not a wrong one).
describe('clause W5h-a: highlight.js stays in the worker, one checked sink, no test seam in pwa/src (M4.H4, M4.H15, M4.H17)', { timeout: 30_000 }, () => {
  const copies: string[] = [];
  afterAll(() => { for (const dir of copies) rmSync(dir, { recursive: true, force: true }); });
  /** A fresh copy of `pwa/src` with `edit` applied to one file (created when absent); returns the copy's base. */
  function planted(rel: string, edit: (old: string) => string): string {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'docs-scans-w5ha-'));
    copies.push(dir);
    cpSync(SRC_DIR, path.join(dir, 'src'), { recursive: true });
    const file = path.join(dir, ...rel.split('/'));
    let old = '';
    try { old = readFileSync(file, 'utf8'); } catch { /* a new file */ }
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, edit(old));
    return dir;
  }
  const append = (text: string) => (old: string): string => old + text;
  /** A fresh copy of `ui/src` with `edit` applied to one file (created when absent); returns the copy's `src` directory. */
  function plantedUi(rel: string, edit: (old: string) => string): string {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'docs-scans-w5ha-ui-'));
    copies.push(dir);
    cpSync(UI_SRC_DIR, path.join(dir, 'src'), { recursive: true });
    const file = path.join(dir, 'src', ...rel.split('/'));
    let old = '';
    try { old = readFileSync(file, 'utf8'); } catch { /* a new file */ }
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, edit(old));
    return path.join(dir, 'src');
  }

  it('M4.H4: highlight.js and the worker chain sit only in their homes across pwa/src', () => {
    const { files, hits } = highlightScan(PWA);
    expect(files).toEqual(expect.arrayContaining(['src/lib/highlightGrammars.ts', 'src/lib/highlightJob.ts', 'src/lib/markdown.tsx']));
    expect(readFileSync(path.join(SRC_DIR, 'lib', 'highlightGrammars.ts'), 'utf8')).toContain("from 'highlight.js/lib/core'");
    expect(hits.filter((h) => !h.endsWith('test:import'))).toEqual([]);
  });

  it('M4.H17: nothing under pwa/src imports from pwa/test', () => {
    expect(highlightScan(PWA).hits.filter((h) => h.endsWith('test:import'))).toEqual([]);
  });

  it('M4.H15: exactly one sink in pwa/src, the checked one in HighlightedCode', () => {
    expect(highlightScan(PWA).sinks).toEqual(['src/lib/markdown.tsx HighlightedCode ok']);
  });

  it('M4.H4 planted: highlight.js imported in lib/markdown.tsx is red', () => {
    const dir = planted('src/lib/markdown.tsx', append("\nimport plantedHljs from 'highlight.js/lib/core';\nexport const plantedH = plantedHljs;\n"));
    expect(highlightScan(dir).hits).toEqual(['src/lib/markdown.tsx highlight.js:import']);
  });

  it('M4.H4 planted: highlightGrammars imported in DocsLeaf, and the worker entry imported by the runner, are red', () => {
    const leaf = planted('src/docs/DocsLeaf.tsx', append("\nimport { HLJS as plantedG } from '../lib/highlightGrammars';\nexport const plantedGr = plantedG;\n"));
    expect(highlightScan(leaf).hits).toEqual(['src/docs/DocsLeaf.tsx highlightGrammars:import']);
    const runner = planted('src/lib/markdownRunner.ts', append("\nimport './markdownHighlightWorker';\n"));
    expect(highlightScan(runner).hits).toEqual(['src/lib/markdownRunner.ts markdownHighlightWorker:import']);
  });

  it('M4.H17 planted: the test store imported from pwa/src is red', () => {
    const dir = planted('src/lib/markdown.tsx', append("\nimport { SYNC_HIGHLIGHT } from '../../test/highlightTestStore';\nexport const plantedSync = SYNC_HIGHLIGHT;\n"));
    expect(highlightScan(dir).hits).toEqual(['src/lib/markdown.tsx test:import']);
  });

  it('M4.H15 planted: a second sink under lib/ or under docs/export/ is red', () => {
    const lib = planted('src/lib/markdown.tsx', append('\nexport function PlantedSink(p: { h: string }) { return <i dangerouslySetInnerHTML={{ __html: p.h }} />; }\n'));
    expect(highlightScan(lib).sinks).toEqual(['src/lib/markdown.tsx HighlightedCode ok', 'src/lib/markdown.tsx PlantedSink bad']);
    const exp = planted('src/docs/export/buildExport.tsx', append("export function Planted() { return <style dangerouslySetInnerHTML={{ __html: 'a{}' }} />; }\n"));
    expect(highlightScan(exp).sinks).toContain('src/docs/export/buildExport.tsx Planted bad');
  });

  it('M4.H15 planted: the sink fed the raw string, unchecked, is red', () => {
    const dir = planted('src/lib/markdown.tsx', (old) => old.replace('__html: checked.html', '__html: raw'));
    expect(highlightScan(dir).sinks).toEqual(['src/lib/markdown.tsx HighlightedCode bad']);
  });

  it('M4.H15 planted: the sink name in a JSX spread is red', () => {
    const dir = planted('src/lib/markdown.tsx', append('\nexport function PlantedSpread(p: { h: string }) { return <i {...{ dangerouslySetInnerHTML: { __html: p.h } }} />; }\n'));
    expect(highlightScan(dir).sinks).toEqual(['src/lib/markdown.tsx HighlightedCode ok', 'src/lib/markdown.tsx PlantedSpread bad']);
  });

  it('M4.H15 planted: the sink name in a props object given to createElement is red', () => {
    const dir = planted('src/lib/markdown.tsx', append("\nexport function PlantedCreate(p: { h: string }) { return createElement('i', { dangerouslySetInnerHTML: { __html: p.h } }); }\n"));
    expect(highlightScan(dir).sinks).toEqual(['src/lib/markdown.tsx HighlightedCode ok', 'src/lib/markdown.tsx PlantedCreate bad']);
  });

  it('M4.H15 planted: the sink name as an element-access key, a string key, a computed key or a shorthand is red; a comment is not', () => {
    const access = planted('src/lib/markdown.tsx', append("\nexport function PlantedAccess(p: { h: string }) { const props: Record<string, unknown> = {}; props['dangerouslySetInnerHTML'] = { __html: p.h }; return props; }\n"));
    expect(highlightScan(access).sinks).toEqual(['src/lib/markdown.tsx HighlightedCode ok', 'src/lib/markdown.tsx PlantedAccess bad']);
    const str = planted('src/lib/markdown.tsx', append("\nexport function PlantedString(p: { h: string }) { return { 'dangerouslySetInnerHTML': { __html: p.h } }; }\n"));
    expect(highlightScan(str).sinks).toEqual(['src/lib/markdown.tsx HighlightedCode ok', 'src/lib/markdown.tsx PlantedString bad']);
    const computed = planted('src/lib/markdown.tsx', append('\nexport function PlantedComputed(p: { h: string }) { return { [`dangerouslySetInnerHTML`]: { __html: p.h } }; }\n'));
    expect(highlightScan(computed).sinks).toEqual(['src/lib/markdown.tsx HighlightedCode ok', 'src/lib/markdown.tsx PlantedComputed bad']);
    const short = planted('src/lib/markdown.tsx', append('\nexport function PlantedShort(p: { h: string }) { const dangerouslySetInnerHTML = { __html: p.h }; return { dangerouslySetInnerHTML }; }\n'));
    expect(highlightScan(short).sinks).toEqual(['src/lib/markdown.tsx HighlightedCode ok', 'src/lib/markdown.tsx PlantedShort bad']);
    const comment = planted('src/lib/markdown.tsx', append("\n// dangerouslySetInnerHTML is named only in this comment, and in 'dangerouslySetInnerHTML' text.\nexport const plantedText = 'dangerouslySetInnerHTML';\n"));
    expect(highlightScan(comment).sinks).toEqual(['src/lib/markdown.tsx HighlightedCode ok']);
  });

  it('M4.H4 planted: highlight.js reached by a path into node_modules, or imported anywhere in ui/src, is red', () => {
    const rel = planted('src/lib/markdown.tsx', append("\nimport plantedPath from '../../node_modules/highlight.js/lib/core';\nexport const plantedP = plantedPath;\n"));
    expect(highlightScan(rel).hits).toEqual(['src/lib/markdown.tsx highlight.js:import']);
    const bare = planted('src/lib/markdown.tsx', append("\nexport { default as plantedBare } from '../../node_modules/highlight.js';\n"));
    expect(highlightScan(bare).hits).toEqual(['src/lib/markdown.tsx highlight.js:import']);
    const ui = plantedUi('lib/plantedHighlight.ts', append("import plantedUi from 'highlight.js/lib/core';\nexport const plantedU = plantedUi;\n"));
    expect(highlightScan(PWA, ui).hits).toEqual(['ui/src/lib/plantedHighlight.ts highlight.js:import']);
    const uiDyn = plantedUi('index.ts', append("\nexport const plantedLoad = () => import('highlight.js/lib/languages/xml');\n"));
    expect(highlightScan(PWA, uiDyn).hits).toEqual(['ui/src/index.ts highlight.js:import']);
  });

  it('M7.11: pwa/src holds exactly one new URL for the highlight worker, in spawnHighlightWorker, whatever its quoting or layout', () => {
    const sites = sourceFiles(SRC_DIR).flatMap((f) => highlightWorkerUrlSites(readFileSync(f, 'utf8'), path.relative(PWA, f).split(path.sep).join('/')));
    expect(sites).toEqual(['src/lib/markdownRunner.ts spawnHighlightWorker']);
    expect(highlightWorkerUrlSites("export const p = () => new Worker(new URL('./markdownHighlightWorker.ts', import.meta.url));", 'x.ts')).toEqual(['x.ts (none)']);
    expect(highlightWorkerUrlSites('export function f() { return new Worker(new URL(\n  "./markdownHighlightWorker", import.meta.url)); }', 'x.ts')).toEqual(['x.ts f']);
    expect(highlightWorkerUrlSites("new URL('./markdownWorker.ts', import.meta.url);", 'x.ts')).toEqual([]);
  });
});

// Clause W5h-a, M7.12 (base spec 2026-10-01 section 7.10): R19's page only reads. In its two modules, read with
// TypeScript's parser: no `.refresh(` call, no `fetch(` (bare or as a member), no `localStorage`, `sessionStorage` or
// `indexedDB`, no `clipboard` member, no import of `lib/storage`, every member read of the `api` import is `docs`, and
// neither production highlighter singleton (`docsHighlighter`, `chatHighlighter`) is named: every worker the page uses is
// one it spawns and ends itself (a fix round of the same task).
// NOT EXHAUSTIVE: a call through an alias (`const r = loaders.refresh`), a computed member, and anything reached
// through `any` or `eval` are not seen; the driver's own test asserts the fake loaders' `refresh` is never called.
const MEASURE_MODULES: readonly string[] = ['src/screens/HighlightMeasure.tsx', 'src/screens/highlightMeasureRun.tsx'];

function measureFindings(source: string, file: string): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: string[] = [];
  for (const use of moduleUses(sf)) if (relativeTarget(file, use.specifier) === 'src/lib/storage') out.push(`${file} storage`);
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n)) {
      const callee = unwrap(n.expression);
      if (memberName(callee) === 'refresh') out.push(`${file} refresh`);
      if ((ts.isIdentifier(callee) && callee.text === 'fetch') || memberName(callee) === 'fetch') out.push(`${file} fetch`);
    }
    if (ts.isIdentifier(n) && ['localStorage', 'sessionStorage', 'indexedDB'].includes(n.text)) out.push(`${file} storage`);
    if (ts.isIdentifier(n) && ['docsHighlighter', 'chatHighlighter'].includes(n.text) && !out.includes(`${file} singleton`)) out.push(`${file} singleton`);
    if ((ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n)) && memberName(n) === 'clipboard') out.push(`${file} clipboard`);
    if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'api' && n.name.text !== 'docs') out.push(`${file} api`);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

describe('clause W5h-a, M7.12: R19\'s measurement page only reads', () => {
  const read = (rel: string): string => readFileSync(path.join(PWA, ...rel.split('/')), 'utf8');

  it('its two modules make no refresh, no fetch of their own, no storage, no clipboard, and read only api.docs', () => {
    expect(read('src/screens/HighlightMeasure.tsx')).toContain('api.docs');
    expect(MEASURE_MODULES.flatMap((f) => measureFindings(read(f), f))).toEqual([]);
  });

  it.each([
    ['a refresh call', 'export const planted = (l: { refresh(p: string): void }) => l.refresh("x");', 'refresh'],
    ['a fetch of its own', "export const planted = () => fetch('/api/x');", 'fetch'],
    ['a storage write', "export const planted = () => localStorage.setItem('k', 'v');", 'storage'],
    ['a clipboard write', "export const planted = () => navigator.clipboard.writeText('x');", 'clipboard'],
    ['another api read', "import { api } from '../lib/api';\nexport const planted = () => api.sessions;", 'api'],
    ['the storage owner', "import { pageStorage } from '../lib/storage';\nexport const planted = pageStorage;", 'storage'],
    ['a production highlighter singleton', "import { docsHighlighter } from '../lib/markdownRunner';\nexport const planted = docsHighlighter;", 'singleton'],
  ])('planted: %s in the run module is red', (_name, text, rule) => {
    const file = 'src/screens/highlightMeasureRun.tsx';
    expect(measureFindings(`${read(file)}\n${text}\n`, file)).toEqual([`${file} ${rule}`]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Clause W5 Share (M4.SH7; spec 2026-10-01 4.5, 4.16): one share door, and one clipboard writer under pwa/src/docs.
// Across `pwa/src`, a call of `share` on the bare `navigator` (`navigator.share(…)`, `navigator?.share(…)`,
// `navigator['share'](…)`,
// through parentheses, `!` and casts) sits only in `docs/ShareSheet.tsx`; under `pwa/src/docs`, a call of a member
// named `writeText` sits only in `docs/share.ts` (`copyText`, which Copy link, the truth line's copy commit and the
// reader's copy op all call). `navigator.canShare(…)` is a capability probe, not a share, and is not counted. Share
// adds no `postMessage` and no `message` listener: clause W8a's walk reads the Share files and finds none.
// NOT EXHAUSTIVE. Known evasions it does not see: `navigator` held in a variable first (`const n = navigator;
// n.share(x)`), destructuring (`const { share } = navigator; share(x)`), a computed key (`navigator[k](x)`),
// `.call` / `.apply` / `.bind` (`navigator.share.call(navigator, x)`, and the same on `writeText`), `Reflect.apply`
// (`Reflect.apply(navigator.share, navigator, [x])`), `window.navigator.share(x)` or `globalThis.navigator.share(x)`
// (the owner is not the bare identifier), a `writeText` reached through an alias (`const w = clipboard.writeText;
// w(t)`), and any other clipboard writer: `clipboard.write(…)` and `document.execCommand('copy')` are not counted.
// Review lens 3 reads for those, and
// docs-share-sheet.test.tsx's receiver case catches a detached call in the sheet itself.
// ---------------------------------------------------------------------------------------------------------------

/** One door use: the file (relative to the scanned base, `/` separators) and which door. */
interface DoorUse { file: string; door: 'share' | 'writeText' }

/** Every `navigator.share(…)` call in one module, and, under `src/docs/`, every `….writeText(…)` call. */
function shareDoorUses(source: string, file: string): DoorUse[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const uses: DoorUse[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n)) {
      const callee = unwrap(n.expression);
      const name = memberName(callee);
      if (name === 'share' && (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee))) {
        const owner = unwrap(callee.expression);
        if (ts.isIdentifier(owner) && owner.text === 'navigator') uses.push({ file, door: 'share' });
      }
      if (name === 'writeText' && file.startsWith('src/docs/')) uses.push({ file, door: 'writeText' });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return uses;
}

/** The door scan over every `.ts` and `.tsx` file under `<base>/src`: the files read, and each use as `<file> <door>`. */
function shareDoorScan(base: string): { files: string[]; uses: string[] } {
  const files = sourceFiles(path.join(base, 'src')).map((f) => path.relative(base, f).split(path.sep).join('/'));
  const uses = files.flatMap((rel) => shareDoorUses(readFileSync(path.join(base, ...rel.split('/')), 'utf8'), rel));
  return { files, uses: uses.map((u) => `${u.file} ${u.door}`) };
}

describe('clause W5 Share: one share door, and one clipboard writer under pwa/src/docs (M4.SH7; M4.T7 Share clause)', () => {
  const copies: string[] = [];
  afterAll(() => {
    for (const dir of copies) rmSync(dir, { recursive: true, force: true });
  });
  /** A copy of `pwa/src` with `text` appended to `rel`; returns the directory holding `src`. */
  function planted(rel: string, text: string): string {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'docs-scans-share-'));
    copies.push(dir);
    cpSync(SRC_DIR, path.join(dir, 'src'), { recursive: true });
    const file = path.join(dir, ...rel.split('/'));
    writeFileSync(file, readFileSync(file, 'utf8') + text);
    return dir;
  }

  it('M4.SH7: navigator.share is called only in docs/ShareSheet.tsx, and under docs/ only docs/share.ts writes the clipboard', () => {
    const { files, uses } = shareDoorScan(PWA);
    expect(files).toEqual(expect.arrayContaining(['src/docs/ShareSheet.tsx', 'src/docs/share.ts', 'src/docs/DocsHead.tsx']));
    expect(uses.sort()).toEqual(['src/docs/ShareSheet.tsx share', 'src/docs/share.ts writeText']);
  });

  it.each([
    ['navigator.share(x)', 'export const f = (x: ShareData) => navigator.share(x);', ['src/docs/x.ts share']],
    ['navigator?.share(x)', 'export const f = (x: ShareData) => navigator?.share(x);', ['src/docs/x.ts share']],
    ["navigator['share'](x)", "export const f = (x: ShareData) => navigator['share'](x);", ['src/docs/x.ts share']],
    ['(navigator as Navigator).share(x)', 'export const f = (x: ShareData) => (navigator as Navigator).share(x);', ['src/docs/x.ts share']],
    ['clipboard.writeText(t)', 'export const f = (t: string) => navigator.clipboard.writeText(t);', ['src/docs/x.ts writeText']],
    ['clipboard?.writeText(t)', 'export const f = (t: string) => navigator.clipboard?.writeText(t);', ['src/docs/x.ts writeText']],
  ])('M4.SH7: the scan reads %s', (_name, source, want) => {
    expect(shareDoorUses(source, 'src/docs/x.ts').map((u) => `${u.file} ${u.door}`)).toEqual(want);
  });

  it.each([
    ['a capability probe', 'export const f = (x: ShareData) => navigator.canShare(x);'],
    ['another owner', 'export const f = (o: { share(x: unknown): void }) => o.share(1);'],
    ['a comment', '// navigator.share(x) is never called here\nexport const x = 1;'],
    ['a string', "export const x = 'navigator.share(x)';"],
  ])('M4.SH7: the scan does not count %s', (_name, source) => {
    expect(shareDoorUses(source, 'src/docs/x.ts')).toEqual([]);
  });

  it("M4.SH7: a clipboard write outside pwa/src/docs is not this clause's", () => {
    expect(shareDoorUses('export const f = (t: string) => navigator.clipboard.writeText(t);', 'src/fleet/x.ts')).toEqual([]);
  });

  it('M4.SH7 planted: a navigator.share in DocsHead is red', () => {
    const dir = planted('src/docs/DocsHead.tsx', "\nexport const plantedShare = (): Promise<void> => navigator.share({ url: 'x' });\n");
    expect(shareDoorScan(dir).uses).toContain('src/docs/DocsHead.tsx share');
  });

  it('M4.SH7 planted: a clipboard write in ShareSheet is red', () => {
    const dir = planted('src/docs/ShareSheet.tsx', "\nexport const plantedCopy = (): Promise<void> => navigator.clipboard.writeText('x');\n");
    expect(shareDoorScan(dir).uses).toContain('src/docs/ShareSheet.tsx writeText');
  });

  it('M4.SH7: Share adds no postMessage and no message listener (clause W8a reads the Share files)', () => {
    const { files, hits } = readerScan(PWA);
    expect(files).toEqual(expect.arrayContaining(['src/docs/share.ts', 'src/docs/ShareSheet.tsx']));
    expect(hits.filter((h) => h.file === 'src/docs/share.ts' || h.file === 'src/docs/ShareSheet.tsx')).toEqual([]);
  });

  it('M4.T7 Share clause: the badge scan reads share.ts and ShareSheet.tsx, and finds no draft state', () => {
    const { files, hits } = scanTree([DOCS_DIR, DOCS_SCREEN], PWA);
    expect(files).toEqual(expect.arrayContaining(['src/docs/share.ts', 'src/docs/ShareSheet.tsx']));
    expect(hits).toEqual([]);
  });
});
