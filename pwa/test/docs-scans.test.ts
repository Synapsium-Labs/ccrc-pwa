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
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ts } from '../../server/test/scan/parse';
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
//   and `srcDoc` forms in `docs/export/buildExport.tsx`, and `default-src 'none'` in `docs/export/policy.ts`, the mockup
//   frame's `iframe` and `srcDoc` forms in `docs/MockupFrame.tsx` (C2 Task 8, M5.13), by exact path too, and the
//   mockup viewer's one (M5.16's last bullet): `default-src 'none'` in `docs/mockup/policy.ts` (`MOCKUP_CSP`), by exact
//   path, never the directory; and the PDF frame's two (X2 P3, spec 2026-11-18 4.4): the `iframe` and `srcDoc` forms in
//   `docs/pdf/PdfFrame.tsx` and `default-src 'none'` in `docs/pdf/pdfPolicy.ts`, by exact path too. The allowance holds
//   whether or not those files exist yet. One more, for the mockup
//   export's snapshot (C2 Task 9, spec 5.6.9 step 3): the STRING `srcdoc` (its strip list names the attribute it drops)
//   in `docs/mockup/exportMockup.ts`, by exact path; an identifier, property name, JSX attribute or `<iframe` string
//   there stays red, and the same string in any other file, `docs/mockup/load.ts` and a sibling `exportMockup2.ts`
//   included, is red.
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
const LIBRARY = '@synapsium-labs/pinax-lib';
/** The two value uses of the adapters that keep them out of the main bundle: ReaderFrame's literal dynamic `import()`s,
 * and the bridge's own static import of the assets (the bridge is itself loaded only through that dynamic import, so
 * what it imports is lazy with it). */
function adapterUseAllowed(file: string, target: string, dynamic: boolean): boolean {
  return (file === ADAPTER_LOADER && dynamic && ['src/docs/reader/bridge', 'src/docs/reader/assets'].includes(target))
    || (file === 'src/docs/reader/bridge.ts' && !dynamic && ['src/docs/reader/assets', 'src/docs/reader/hostAppearance', 'src/docs/reader/appearance'].includes(target))
    || (file === 'src/docs/reader/hostAppearance.ts' && !dynamic && target === 'src/docs/reader/appearance');
}
/** The worker-side render job, as a base-relative path without its extension. */
const RENDER_JOB = 'src/lib/readerRenderJob';
/** The two reader adapters that must stay out of the main bundle, base-relative without an extension. */
const READER_ADAPTERS: readonly string[] = ['src/docs/reader/bridge', 'src/docs/reader/assets', 'src/docs/reader/hostAppearance', 'src/docs/reader/appearance'];
/** The one file that may load them, and only as a literal dynamic `import()` (the "Library imports" constraint). */
const ADAPTER_LOADER = 'src/docs/ReaderFrame.tsx';

/** One finding: the file (relative to the scanned base, `/` separators), where, and which rule. */
interface ReaderHit { file: string; at: string; rule: string }

/** The homes of the library's entry points: a subpath predicate and the predicate of the files that may use it. */
const LIBRARY_HOMES: ReadonlyArray<readonly [(sub: string) => boolean, (file: string) => boolean]> = [
  [(sub) => sub === '/host', (file) => file === 'src/docs/reader/bridge.ts'],
  [(sub) => sub === '/render', (file) => file === 'src/lib/readerRenderJob.ts'],
  [(sub) => /^\/assets\/.+\?raw$/.test(sub), (file) => file === 'src/docs/reader/assets.ts'],
  [(sub) => sub === '/frame', (file) => ['src/docs/reader/bridge.ts', 'src/docs/reader/assets.ts', 'src/docs/reader/labPolicy.ts', 'src/docs/reader/appearance.ts'].includes(file)],
];

/** Where the message scan reads: all of `pwa/src`. */
const inMessageScope = (file: string): boolean => file.startsWith('src/');
/** The only files that may assign `window.onmessage` / `self.onmessage`: the parse workers' own entries. */
const MESSAGE_ASSIGN_HOMES: readonly string[] = ['src/lib/markdownWorker.ts', 'src/lib/markdownHighlightWorker.ts'];
/** The only file with a value import of the render job: the worker entry (M8.21). */
const renderJobValueHome = (file: string): boolean => file === 'src/lib/markdownWorker.ts';

/** The mockup viewer's one frame file (C2 Task 8, M5.13): the only file besides Export's builder that may draw the JSX `iframe`
 *  or name `srcdoc`, by exact path, never the directory or a prefix (`MockupFrame2.tsx` and `MockupView.tsx` are not it). */
const MOCKUP_FRAME_HOME = 'src/docs/MockupFrame.tsx';

/** The PDF frame's one frame file (X2 P3, spec 2026-11-18 4.4): like the mockup's, the only file of its viewer that may draw the
 *  JSX `iframe` or name `srcdoc`, by exact path, never the directory or a prefix. */
const PDF_FRAME_HOME = 'src/docs/pdf/PdfFrame.tsx';

/** The PDF frame's one policy file (X2 P3): the only file of its viewer that may spell `default-src 'none'`, by exact path. */
const PDF_POLICY_HOME = 'src/docs/pdf/pdfPolicy.ts';

/** The one file that may spell the string `srcdoc` without drawing a frame: the mockup export's snapshot, whose strip list
 *  names the attribute it removes (C2 Task 9). By exact path, and for the string form only. */
const SRCDOC_STRING_HOME = 'src/docs/mockup/exportMockup.ts';

/** Export's two allowances, by exact path (A2b, M8.10): the `iframe` element and `srcDoc`, and the `default-src 'none'` string;
 *  the mockup frame's `iframe` and `srcDoc` (`MOCKUP_FRAME_HOME`); and the PDF frame's two (`PDF_FRAME_HOME`, `PDF_POLICY_HOME`). */
function exportAllows(kind: 'iframe' | 'policy', file: string): boolean {
  return kind === 'iframe'
    ? file === 'src/docs/export/buildExport.tsx' || file === MOCKUP_FRAME_HOME || file === PDF_FRAME_HOME
    : file === 'src/docs/export/policy.ts' || file === PDF_POLICY_HOME;
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
        if (/srcdoc/i.test(text) && !exportAllows('iframe', file) && file !== SRCDOC_STRING_HOME) hit(n, 'docs:srcDoc');
        if (/default-src\s+'none'/i.test(text) && !exportAllows('policy', file) && file !== 'src/docs/mockup/policy.ts') hit(n, 'docs:default-src-none');
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

/** `scanReaderFile`'s answers in this test process, keyed by the file's relative path and its exact text (#3450: the parse of
 *  every file on every scan was the cost of the planted cases, not their copies). The answer is a pure function of those two:
 *  `scanReaderFile` reads only its `source` and `file` arguments and this module's constants (the homes, the library name and
 *  the allow rules, none reassigned), never the tree's root, another file or an option, so the key is complete. A planted
 *  file's text differs from the real one's, so it is always parsed afresh. In memory only, and `readerScan`'s alone. */
const READER_SCAN_CACHE = new Map<string, { hits: ReaderHit[]; uses: string[] }>();

/** The reader scan over every `.ts` and `.tsx` file under `<base>/src`, named relative to `base`. */
function readerScan(base: string): { files: string[]; hits: ReaderHit[]; uses: string[] } {
  const files = sourceFiles(path.join(base, 'src')).map((f) => path.relative(base, f).split(path.sep).join('/'));
  const found = files.map((rel) => {
    const source = readFileSync(path.join(base, ...rel.split('/')), 'utf8');
    const key = `${rel}\0${source}`;
    let answer = READER_SCAN_CACHE.get(key);
    if (answer === undefined) READER_SCAN_CACHE.set(key, answer = scanReaderFile(source, rel));
    return answer;
  });
  return { files, hits: found.flatMap((f) => f.hits), uses: found.flatMap((f) => f.uses) };
}

/** The case budget of every clause below that copies the tree (W8a, W5h-a, W5 Share, W5 Export, W5h-b, C1). Sized for a slow
 *  runner from a measurement (#3450): with the scan caches, the slowest case of those clauses took 5.7 s on the fleet box
 *  (three runs of this file at load 27 to 32; before the caches it was 13 to 29 s); the issue's queue runs show a slow hosted
 *  runner taking about 2.03 times a fast one (Task 9: 30.5 s against 15.0 s), so about 11.6 s there, and 30 s leaves 2.6 times
 *  that. */
const TREE_COPY_TIMEOUT_MS = 30_000;

// Each planted case copies the whole of pwa/src and scans the copy (the ReaderFrame case three times; the scan cache parses
// only what a plant changed); on a loaded merge-queue runner that has passed vitest's 5 s default, so the clause gives its
// cases `TREE_COPY_TIMEOUT_MS`, as clause W5h-a's do.
describe('clause W8a: the reader library has its homes (M8.10 amended, M8.21)', { timeout: TREE_COPY_TIMEOUT_MS }, () => {
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
      'src/docs/reader/bridge.ts @synapsium-labs/pinax-lib/host',
      'src/docs/reader/bridge.ts @synapsium-labs/pinax-lib/frame',
      'src/lib/readerRenderJob.ts @synapsium-labs/pinax-lib/render',
      'src/docs/reader/assets.ts @synapsium-labs/pinax-lib/assets/frame/guard.js?raw',
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
    plant(dir, 'src/docs/DocsLeaf.tsx', "\nimport { createHost } from '@synapsium-labs/pinax-lib/host';\nvoid createHost;\n");
    expect(names(readerScan(dir).hits, 'library:')).toEqual(['src/docs/DocsLeaf.tsx library:/host']);
  });

  it('M8.10 planted: a /render import in DocsLeaf is red', () => {
    const dir = treeCopy();
    plant(dir, 'src/docs/DocsLeaf.tsx', "\nimport { render } from '@synapsium-labs/pinax-lib/render';\nvoid render;\n");
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

  it("M5.16: the mockup viewer's default-src none is allowed at src/docs/mockup/policy.ts only, and the same string in src/docs/mockup/origins.ts is red", () => {
    const dir = treeCopy();
    plant(dir, 'src/docs/mockup/policy.ts', "export const PLANTED_MOCKUP_POLICY = \"default-src 'none'\";\n");
    expect(readerScan(dir).hits).toEqual([]);
    plant(dir, 'src/docs/mockup/origins.ts', "export const PLANTED_ORIGIN_POLICY = \"default-src 'none'\";\n");
    expect(names(readerScan(dir).hits, 'docs:')).toEqual(['src/docs/mockup/origins.ts docs:default-src-none']);
  });

  it("M5.13: the mockup frame's iframe and srcDoc are allowed at src/docs/MockupFrame.tsx only; the same in MockupView.tsx and in a sibling path are red", () => {
    const dir = treeCopy();
    plant(dir, 'src/docs/MockupFrame.tsx', "\nexport const PlantedMockupFrame = () => <iframe srcDoc=\"x\" />;\n");
    expect(readerScan(dir).hits).toEqual([]);
    plant(dir, 'src/docs/MockupView.tsx', "\nexport const PlantedMockupView = () => <iframe srcDoc=\"x\" />;\n");
    expect(names(readerScan(dir).hits, 'docs:')).toEqual(['src/docs/MockupView.tsx docs:iframe', 'src/docs/MockupView.tsx docs:srcDoc']);
    const sibling = treeCopy();
    plant(sibling, 'src/docs/MockupFrame2.tsx', "export const PlantedSibling = () => <iframe srcDoc=\"x\" />;\n");
    expect(names(readerScan(sibling).hits, 'docs:')).toEqual(['src/docs/MockupFrame2.tsx docs:iframe', 'src/docs/MockupFrame2.tsx docs:srcDoc']);
  });

  it("X2 P3: the PDF frame's iframe and srcDoc are allowed at src/docs/pdf/PdfFrame.tsx only, its policy string at pdfPolicy.ts only; the same in a sibling is red", () => {
    const dir = treeCopy();
    plant(dir, PDF_FRAME_HOME, "\nexport const PlantedPdfFrame = () => <iframe srcDoc=\"x\" />;\n");
    plant(dir, PDF_POLICY_HOME, "\nexport const PLANTED_PDF_POLICY = \"default-src 'none'\";\n");
    expect(readerScan(dir).hits).toEqual([]);
    const sibling = treeCopy();
    plant(sibling, 'src/docs/pdf/PdfLeaf.tsx', "\nexport const PlantedLeaf = () => <iframe srcDoc=\"x\" />;\n");
    plant(sibling, 'src/docs/pdf/pdfSrcdoc.ts', "\nexport const PLANTED_PDF_POLICY = \"default-src 'none'\";\n");
    expect(names(readerScan(sibling).hits, 'docs:')).toEqual([
      'src/docs/pdf/PdfLeaf.tsx docs:iframe', 'src/docs/pdf/PdfLeaf.tsx docs:srcDoc', 'src/docs/pdf/pdfSrcdoc.ts docs:default-src-none',
    ]);
  });

  it("Task 9: the snapshot's srcdoc STRING is allowed at src/docs/mockup/exportMockup.ts only; every other form there, and the string in load.ts or a sibling, is red", () => {
    const home = 'src/docs/mockup/exportMockup.ts';
    const dir = treeCopy();
    plant(dir, home, "\nexport const PLANTED_STRIP = new Set(['srcdoc', 'action']);\n");
    expect(readerScan(dir).hits).toEqual([]);
    // The allowance is the string form only: an identifier, a property name, a JSX attribute and an iframe string stay red.
    expect(names(readerScan(dir).hits, 'docs:')).toEqual([]);
    const forms: Array<[string, string, string[]]> = [
      ['an identifier', '\nexport const srcdoc = 1;\n', [`${home} docs:srcDoc`]],
      ['a property name', '\nexport const planted = { srcDoc: 1 };\n', [`${home} docs:srcDoc`]],
      ['a member write', '\nexport const planted = (el: { x: string }, v: string) => { (el as never as { srcdoc: string }).srcdoc = v; };\n',
        [`${home} docs:srcDoc`, `${home} docs:srcDoc`]],
      ['an iframe string', "\nexport const PLANTED_TAG = '<iframe>';\n", [`${home} docs:iframe`]],
    ];
    for (const [, text, want] of forms) {
      const d = treeCopy();
      plant(d, home, text);
      expect(names(readerScan(d).hits, 'docs:'), text).toEqual(want);
    }
    // A JSX frame planted in the file is red (the file is a `.ts`, so the scanner reads it as one: the attribute is a name).
    const jsx = treeCopy();
    plant(jsx, home, '\nexport const PlantedFrame = () => <iframe srcDoc="x" />;\n');
    expect(names(readerScan(jsx).hits, 'docs:')).toContain(`${home} docs:srcDoc`);
    for (const rel of ['src/docs/mockup/load.ts', 'src/docs/mockup/exportMockup2.ts']) {
      const other = treeCopy();
      plant(other, rel, "\nexport const PLANTED_STRIP = new Set(['srcdoc']);\n");
      expect(names(readerScan(other).hits, 'docs:'), rel).toEqual([`${rel} docs:srcDoc`]);
    }
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

  // The onmessage arm reads its owner from a list (`window`, `self`, `globalThis`); each owner has its own planted control,
  // so dropping one from the list reds its case (W8a review 1318's residue; D2 Task 13).
  it('M8.10 planted: a window.onmessage assignment in lib/router is red', () => {
    expect(planted(ROUTER, '\nwindow.onmessage = () => undefined;\n')).toEqual([`${ROUTER} message:onmessage`]);
  });

  it('M8.10 planted: a globalThis.onmessage assignment in lib/router is red', () => {
    expect(planted(ROUTER, '\nglobalThis.onmessage = () => undefined;\n')).toEqual([`${ROUTER} message:onmessage`]);
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
    expect(planted(LEAF, "\nimport * as planted from '@synapsium-labs/pinax-lib';\nvoid planted;\n")).toEqual([`${LEAF} library:(bare)`]);
  });

  it('M8.10 planted: an /enhance import in DocsLeaf is red', () => {
    expect(planted(LEAF, "\nimport * as planted from '@synapsium-labs/pinax-lib/enhance';\nvoid planted;\n")).toEqual([`${LEAF} library:/enhance`]);
  });

  it('M8.10 planted: a /frame import in DocsLeaf is red', () => {
    expect(planted(LEAF, "\nimport { frameDocument } from '@synapsium-labs/pinax-lib/frame';\nvoid frameDocument;\n"))
      .toEqual([`${LEAF} library:/frame`]);
  });

  it('M8.10 planted: an /assets raw import outside assets.ts is red', () => {
    expect(planted(LEAF, "\nimport planted from '@synapsium-labs/pinax-lib/assets/frame/guard.js?raw';\nvoid planted;\n"))
      .toEqual([`${LEAF} library:/assets`]);
  });

  it("Library imports: the reader adapters reach the main bundle only through ReaderFrame's two dynamic imports", () => {
    const { hits, uses } = readerScan(PWA);
    const loader = (spec: string): string[] => uses.filter((u) => u === `src/docs/ReaderFrame.tsx ${spec}`);
    // The bridge is named twice there (an `import type` and the dynamic import), the assets once (the dynamic import).
    expect(loader('./reader/bridge')).toHaveLength(2);
    expect(loader('./reader/assets')).toHaveLength(1);
    expect(uses.filter((u) => /\/reader\/(?:bridge|assets)$/.test(u))).toHaveLength(3);
    expect(uses.filter((u) => / \.\/(?:hostAppearance|appearance)$/.test(u))).toEqual([
      'src/docs/reader/bridge.ts ./hostAppearance', 'src/docs/reader/bridge.ts ./appearance',
      'src/docs/reader/hostAppearance.ts ./appearance',
    ]);
    expect(names(hits, 'main-bundle:')).toEqual([]);
  });

  it('appearance adapters and frame imports cannot enter the main bundle', () => {
    for (const [file, spec] of [
      ['src/docs/ReaderFrame.tsx', './reader/hostAppearance'],
      ['src/docs/ReaderFrame.tsx', './reader/appearance'],
      ['src/docs/DocsHead.tsx', './reader/appearance'],
    ]) {
      expect(planted(file!, `\nimport * as plantedAppearance from '${spec}';\nvoid plantedAppearance;\n`))
        .toEqual([`${file} main-bundle:value-import`]);
    }
    for (const file of ['src/docs/reader/policy.ts', 'src/docs/reader/images.ts']) {
      expect(planted(file, "\nimport * as plantedFrame from '@synapsium-labs/pinax-lib/frame';\nvoid plantedFrame;\n"))
        .toEqual([`${file} library:/frame`]);
    }
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

  it('the scan cache (#3450): the real tree scanned with a cold cache and again warm gives the same answer', () => {
    READER_SCAN_CACHE.clear();
    const cold = readerScan(PWA);
    expect(READER_SCAN_CACHE.size).toBe(cold.files.length);
    expect(readerScan(PWA)).toEqual(cold);
  });

  it('the scan cache (#3450): a plant into a file the warm cache holds is seen', () => {
    const { files } = readerScan(PWA);
    expect(files).toContain(LEAF);
    expect(READER_SCAN_CACHE.size).toBeGreaterThanOrEqual(files.length);
    const dir = treeCopy();
    plant(dir, LEAF, "\nimport { createHost } from '@synapsium-labs/docserver/host';\nvoid createHost;\n");
    expect(names(readerScan(dir).hits, 'library:')).toEqual([`${LEAF} library:/host`]);
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

/** `highlightScan`'s per-file answers in this test process, keyed by which half of the scan made the answer (`src` for
 *  `scanHighlightFile` over `<base>/src`, `ui` for the specifier hits over `uiSrc`), the file's relative path and its exact text
 *  (#3450, as `READER_SCAN_CACHE`). Each answer is a pure function of those three: both halves read only the file's text, its
 *  relative path (the `.tsx` kind included) and this module's constants (the highlight homes, the chain and the sink name, none
 *  reassigned), never the tree's root, another file or an option, so the key is complete. A planted file's text differs from
 *  the real one's, so it is always parsed afresh. In memory only, and `highlightScan`'s alone. */
const HIGHLIGHT_SCAN_CACHE = new Map<string, { hits: string[]; sinks: string[] }>();

/** The scan over every `.ts` and `.tsx` file under `<base>/src`, named relative to `base`, and over `uiSrc` (named `ui/src/...`). */
function highlightScan(base: string, uiSrc: string = UI_SRC_DIR): { files: string[]; hits: string[]; sinks: string[] } {
  const cached = (half: 'src' | 'ui', rel: string, source: string, scan: () => { hits: string[]; sinks: string[] }) => {
    const key = `${half}\0${rel}\0${source}`;
    let answer = HIGHLIGHT_SCAN_CACHE.get(key);
    if (answer === undefined) HIGHLIGHT_SCAN_CACHE.set(key, answer = scan());
    return answer;
  };
  const files = sourceFiles(path.join(base, 'src')).map((f) => path.relative(base, f).split(path.sep).join('/'));
  const found = files.map((rel) => {
    const source = readFileSync(path.join(base, ...rel.split('/')), 'utf8');
    return cached('src', rel, source, () => scanHighlightFile(source, rel));
  });
  const uiHits = sourceFiles(uiSrc).flatMap((f) => {
    const rel = `ui/src/${path.relative(uiSrc, f).split(path.sep).join('/')}`;
    const source = readFileSync(f, 'utf8');
    return cached('ui', rel, source, () => {
      const sf = ts.createSourceFile(rel, source, ts.ScriptTarget.Latest, true, f.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
      return { hits: highlightSpecifierHits(sf, rel), sinks: [] };
    }).hits;
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

// Each planted case copies the whole of pwa/src and scans the copy (the scan cache parses only what a plant changed); under a
// loaded box that has passed vitest's 5 s default, so the clause gives its cases `TREE_COPY_TIMEOUT_MS` (a slow scan is not a
// wrong one).
describe('clause W5h-a: highlight.js stays in the worker, one checked sink, no test seam in pwa/src (M4.H4, M4.H15, M4.H17)', { timeout: TREE_COPY_TIMEOUT_MS }, () => {
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

  it('the scan cache (#3450): the real trees scanned with a cold cache and again warm give the same answer', () => {
    HIGHLIGHT_SCAN_CACHE.clear();
    const cold = highlightScan(PWA);
    expect(HIGHLIGHT_SCAN_CACHE.size).toBe(cold.files.length + sourceFiles(UI_SRC_DIR).length);
    expect(highlightScan(PWA)).toEqual(cold);
  });

  it('the scan cache (#3450): a plant into a file the warm cache holds is seen, in either half', () => {
    const { files } = highlightScan(PWA);
    expect(files).toContain('src/lib/markdown.tsx');
    expect(existsSync(path.join(UI_SRC_DIR, 'index.ts'))).toBe(true);
    expect(HIGHLIGHT_SCAN_CACHE.size).toBeGreaterThanOrEqual(files.length + sourceFiles(UI_SRC_DIR).length);
    const dir = planted('src/lib/markdown.tsx', append("\nimport plantedHljs from 'highlight.js/lib/core';\nexport const plantedH = plantedHljs;\n"));
    expect(highlightScan(dir).hits).toEqual(['src/lib/markdown.tsx highlight.js:import']);
    const ui = plantedUi('index.ts', append("\nexport const plantedLoad = () => import('highlight.js/lib/languages/xml');\n"));
    expect(highlightScan(PWA, ui).hits).toEqual(['ui/src/index.ts highlight.js:import']);
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

// Its planted cases copy the whole of pwa/src too, so it takes the same bound, `TREE_COPY_TIMEOUT_MS`.
describe('clause W5 Share: one share door, and one clipboard writer under pwa/src/docs (M4.SH7; M4.T7 Share clause)', { timeout: TREE_COPY_TIMEOUT_MS }, () => {
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

// ---------------------------------------------------------------------------------------------------------------
// Clause W5 Export (spec 2026-10-01 4.17; M4.EX2's scan, M4.EX11, M4.EX16, M4.EX17, M4.T7's Export clause), read with
// TypeScript's parser:
//   - M4.EX2: in `docs/export/**`, `docs/ExportSheet.tsx`, `docs/share.ts`, `docs/ShareSheet.tsx` and, from C2 Task 9,
//     `docs/mockup/exportMockup.ts` (the snapshot, by exact path, not its directory): no
//     `dangerouslySetInnerHTML` (any spelling clause W5h-a's `namesSink` reads), no assignment to `innerHTML` or
//     `outerHTML`, no `insertAdjacentHTML` call, no `document.write` or `document.writeln` call, and no string or
//     template piece that begins with `<` and a letter, `/` or `!`, except `EXPORT_PREFIX`'s own initialiser in
//     `docs/export/policy.ts`;
//   - M4.EX11: the name `imagePinFor` (a call, an import, any identifier) appears only in `docs/docsLinks.ts`, its
//     definition, `docs/DocImage.tsx`, whose `planImageRef` is the one way Export reaches it, and, from W6 (completion
//     plan Task 6, C1), `docs/mockup/plan.ts`, the mockup planner (base 4.11), and in no other mockup file;
//   - M4.EX16: across `pwa/src`, a `react-dom/server` specifier (any subpath) and the name `renderToStaticMarkup` only in
//     `docs/export/buildExport.tsx`, which exports `buildExport` and types only; `./export/buildExport` imported only by
//     `docs/ExportSheet.tsx`, through a dynamic `import()`; `ExportSheet.tsx` calls `downloadExport`, reads no member
//     named `bytes`, and holds no `srcDoc`, `innerHTML`, `document.write` or `window.open`; under `pwa/src/docs` and
//     `lib/markdown*`, `new Blob(`, `new File(` and `URL.createObjectURL(` only in `docs/objectUrls.ts`; and in W5 no JSX
//     `iframe` element and no `srcDoc` attribute anywhere in `pwa/src` (refinement (v)); W6 (C2 Task 8) adds exactly one
//     home, `docs/MockupFrame.tsx`, for both, and C2 Task 9 a second, `docs/export/buildExport.tsx` (the mockup export's
//     wrapper frame, M5.16): both names appear there and nowhere else beside the first;
//   - M4.EX17: the run-time import closure of `docs/export/buildExport.tsx`, static and dynamic, through every relative
//     specifier, holds neither `lib/markdownHighlightWorker.ts` nor `lib/highlightGrammars.ts`, and no `highlight.js`
//     specifier (from C2 Task 9 the closure runs through `docs/mockup/exportMockup.ts` too);
//   - M4.T7: clause 1's badge scan reads the export files and finds no draft state.
// NOT EXHAUSTIVE. Known evasions: a specifier, a name or a tag built at run time; a sink, `write`, `open` or `bytes`
// reached through an alias (`const w = document.write`, `const { bytes } = result`); `Reflect.set` or
// `Object.defineProperty` onto `innerHTML`; an `@/` import in the closure (`ui/src` holds no highlight.js: clause
// W5h-a); `require`. The behavioural halves are docs-export.test.tsx (the hostile corpus) and the browser leg (M5.B9).
// ---------------------------------------------------------------------------------------------------------------

const parse = (source: string, file: string): ts.SourceFile =>
  ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

const PDF_ASSETS_HOME = 'src/docs/pdf/pdfAssets.ts';

/** The installed PDF library is data only. Detect literal dependencies across the app, not only PDF's siblings. */
function pdfDependencyHits(source: string, file: string): string[] {
  if (!source.includes('pdfjs-dist')) return [];
  const sf = parse(source, file);
  const approved = new Set<ts.Node>();
  if (file === PDF_ASSETS_HOME) {
    for (const use of moduleUses(sf)) {
      if (ts.isImportDeclaration(use.node) && /^pdfjs-dist\/build\/pdf(?:\.worker)?\.min\.mjs\?raw$/.test(use.specifier)) {
        approved.add(use.node.moduleSpecifier);
      }
    }
    const globs = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && n.expression.getText(sf) === 'import.meta.glob') {
        const p = n.arguments[0];
        if (p !== undefined && isPlainString(p) && (p.text === '/node_modules/pdfjs-dist/standard_fonts/*.{pfb,ttf}'
          || p.text === '/node_modules/pdfjs-dist/cmaps/*.bcmap')) approved.add(p);
      }
      ts.forEachChild(n, globs);
    };
    globs(sf);
  }
  const hits: string[] = [];
  const visit = (n: ts.Node): void => {
    const text = stringText(n);
    if (text !== undefined && /(?:^|\/)pdfjs-dist(?:$|\/)/.test(text) && !approved.has(n)) hits.push(`${file} ${text}`);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return hits;
}

describe('pdf dependency: no app runtime import of pdfjs-dist', () => {
  it('only the adapter takes raw viewer and parser text, fonts and CMaps', () => {
    expect(sourceFiles(SRC_DIR).flatMap((f) => pdfDependencyHits(readFileSync(f, 'utf8'), path.relative(PWA, f).split(path.sep).join('/'))))
      .toEqual([]);
  });

  it('detects a raw sibling import and a runtime import even in the allowed adapter', () => {
    expect(pdfDependencyHits("import src from 'pdfjs-dist/build/pdf.min.mjs?raw';", 'src/screens/Example.tsx')).toHaveLength(1);
    expect(pdfDependencyHits("const m = import('pdfjs-dist');", PDF_ASSETS_HOME)).toHaveLength(1);
  });
});

/** The files M4.EX2's token rule reads. */
const exportInertScope = (file: string): boolean => file.startsWith('src/docs/export/')
  || ['src/docs/ExportSheet.tsx', 'src/docs/share.ts', 'src/docs/ShareSheet.tsx', 'src/docs/mockup/exportMockup.ts'].includes(file);

/** Whether `n` sits in the initialiser of `EXPORT_PREFIX` in `docs/export/policy.ts`. */
function inExportPrefix(n: ts.Node, file: string): boolean {
  if (file !== 'src/docs/export/policy.ts') return false;
  let p: ts.Node | undefined = n.parent;
  while (p !== undefined && !ts.isVariableDeclaration(p)) p = p.parent;
  return p !== undefined && ts.isIdentifier(p.name) && p.name.text === 'EXPORT_PREFIX';
}

/** `<owner>.<name>(…)` with the bare identifier `owner`. */
function callsOn(n: ts.CallExpression, owner: string, names: readonly string[]): string | undefined {
  const callee = unwrap(n.expression);
  const name = memberName(callee);
  if (name === undefined || !names.includes(name)) return undefined;
  if (!ts.isPropertyAccessExpression(callee) && !ts.isElementAccessExpression(callee)) return undefined;
  const o = unwrap(callee.expression);
  return ts.isIdentifier(o) && o.text === owner ? `${owner}.${name}` : undefined;
}

/** M4.EX2's findings in one module, `<file> <rule>`. */
function exportInertHits(source: string, file: string): string[] {
  const hits = new Set<string>();
  const visit = (n: ts.Node): void => {
    if (namesSink(n)) hits.add(`${file} sink`);
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const name = memberName(unwrap(n.left));
      if (name === 'innerHTML' || name === 'outerHTML') hits.add(`${file} ${name}`);
    }
    if (ts.isCallExpression(n)) {
      if (memberName(unwrap(n.expression)) === 'insertAdjacentHTML') hits.add(`${file} insertAdjacentHTML`);
      const write = callsOn(n, 'document', ['write', 'writeln']);
      if (write !== undefined) hits.add(`${file} ${write}`);
    }
    const text = stringText(n);
    if (text !== undefined && /^<[A-Za-z/!]/.test(text) && !inExportPrefix(n, file)) hits.add(`${file} markup-string`);
    ts.forEachChild(n, visit);
  };
  visit(parse(source, file));
  return [...hits];
}

/** M4.EX11, M4.EX16's findings in one module, `<file> <use>`, each once. */
function exportUses(source: string, file: string): string[] {
  const sf = parse(source, file);
  const uses = new Set<string>();
  for (const use of moduleUses(sf)) {
    if (/^react-dom\/server(?:[./]|$)/.test(use.specifier)) uses.add(`${file} react-dom/server`);
    if (use.value && relativeTarget(file, use.specifier) === 'src/docs/export/buildExport') {
      uses.add(`${file} buildExport:${use.dynamic ? 'dynamic' : 'static'}`);
    }
  }
  const blobScope = file.startsWith('src/docs/') || file.startsWith('src/lib/markdown');
  const visit = (n: ts.Node): void => {
    if (ts.isIdentifier(n) && n.text === 'renderToStaticMarkup') uses.add(`${file} renderToStaticMarkup`);
    if (ts.isIdentifier(n) && n.text === 'imagePinFor') uses.add(`${file} imagePinFor`);
    if (blobScope && ts.isNewExpression(n) && ts.isIdentifier(n.expression) && (n.expression.text === 'Blob' || n.expression.text === 'File')) {
      uses.add(`${file} new ${n.expression.text}`);
    }
    if (blobScope && ts.isCallExpression(n) && callsOn(n, 'URL', ['createObjectURL']) !== undefined) uses.add(`${file} createObjectURL`);
    if ((ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) && ts.isIdentifier(n.tagName) && n.tagName.text === 'iframe') {
      uses.add(`${file} iframe`);
    }
    if (ts.isJsxAttribute(n) && ts.isIdentifier(n.name) && n.name.text.toLowerCase() === 'srcdoc') uses.add(`${file} srcDoc`);
    if (file === 'src/docs/ExportSheet.tsx') {
      if (memberName(n) === 'bytes') uses.add(`${file} bytes`);
      if (memberName(n) === 'innerHTML') uses.add(`${file} innerHTML`);
      if (ts.isCallExpression(n)) {
        const callee = unwrap(n.expression);
        if (ts.isIdentifier(callee) && callee.text === 'downloadExport') uses.add(`${file} downloadExport`);
        if (callsOn(n, 'document', ['write', 'writeln']) !== undefined) uses.add(`${file} document.write`);
        if (callsOn(n, 'window', ['open']) !== undefined) uses.add(`${file} window.open`);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return [...uses];
}

/** The names `buildExport.tsx` exports as values (a function, a class, a variable, or an `export { … }` that is not
 *  type-only). */
function exportedValues(source: string, file: string): string[] {
  const out: string[] = [];
  for (const st of parse(source, file).statements) {
    const exported = ts.canHaveModifiers(st) && (ts.getModifiers(st) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (exported && (ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) && st.name !== undefined) out.push(st.name.text);
    if (exported && ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name)) out.push(d.name.text);
    }
    if (ts.isExportDeclaration(st) && !st.isTypeOnly && st.exportClause !== undefined && ts.isNamedExports(st.exportClause)) {
      for (const e of st.exportClause.elements) if (!e.isTypeOnly) out.push(e.name.text);
    }
  }
  return out;
}

/** A base-relative module path (no extension) as the source file it names, or undefined (a stylesheet, a package). */
function sourceOf(base: string, mod: string): string | undefined {
  for (const ext of ['.ts', '.tsx', '/index.ts', '/index.tsx']) {
    try {
      if (statSync(path.join(base, mod + ext)).isFile()) return mod + ext;
    } catch { /* absent */ }
  }
  return undefined;
}

/** M4.EX17: the run-time import closure of `entry` under `base`: its source files and every bare specifier on the way. */
function closureFrom(base: string, entry: string): { files: string[]; bare: string[] } {
  const files = new Set<string>();
  const bare: string[] = [];
  const queue = [entry];
  while (queue.length > 0) {
    const file = sourceOf(base, queue.shift()!);
    if (file === undefined || files.has(file)) continue;
    files.add(file);
    for (const use of moduleUses(parse(readFileSync(path.join(base, file), 'utf8'), file))) {
      if (!use.value) continue;
      const target = relativeTarget(file, use.specifier);
      if (target === undefined) bare.push(use.specifier);
      else queue.push(target);
    }
  }
  return { files: [...files].sort(), bare };
}

/** M4.EX17: which of the two highlight modules (the worker's, the grammars') a closure's files name. The real-tree case and
 *  both planted cases call this one filter, so a planted module that this filter fails to flag is red. */
const highlightModulesIn = (files: readonly string[]): string[] =>
  files.filter((f) => f === 'src/lib/markdownHighlightWorker.ts' || f === 'src/lib/highlightGrammars.ts');

/** Every finding of `scan` over the `.ts`/`.tsx` files under `<base>/src`, sorted. */
function scanSrc(base: string, scan: (source: string, file: string) => string[], scope: (file: string) => boolean = () => true): string[] {
  return sourceFiles(path.join(base, 'src')).map((f) => path.relative(base, f).split(path.sep).join('/'))
    .filter(scope).flatMap((rel) => scan(readFileSync(path.join(base, ...rel.split('/')), 'utf8'), rel)).sort();
}

describe('clause W5 Export: inert by construction, confined, one pin rule, no highlighter (M4.EX2, M4.EX11, M4.EX16, M4.EX17, M4.T7)', { timeout: TREE_COPY_TIMEOUT_MS }, () => {
  const copies: string[] = [];
  afterAll(() => {
    for (const dir of copies) rmSync(dir, { recursive: true, force: true });
  });
  /** A copy of `pwa/src` with `text` appended to `rel`; returns the copy's base. */
  function planted(rel: string, text: string): string {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'docs-scans-export-'));
    copies.push(dir);
    cpSync(SRC_DIR, path.join(dir, 'src'), { recursive: true });
    const file = path.join(dir, ...rel.split('/'));
    writeFileSync(file, readFileSync(file, 'utf8') + text);
    return dir;
  }

  it('M4.EX2: the export files hold no sink, no HTML writer and no markup string but EXPORT_PREFIX', () => {
    const files = sourceFiles(path.join(SRC_DIR, 'docs')).map((f) => path.relative(PWA, f).split(path.sep).join('/')).filter(exportInertScope);
    expect(files).toEqual(expect.arrayContaining([
      'src/docs/ExportSheet.tsx', 'src/docs/ShareSheet.tsx', 'src/docs/export/buildExport.tsx', 'src/docs/export/exportMarkdown.tsx',
      'src/docs/export/policy.ts', 'src/docs/share.ts', 'src/docs/mockup/exportMockup.ts',
    ]));
    expect(scanSrc(PWA, exportInertHits, exportInertScope)).toEqual([]);
  });

  it.each([
    ['a markup string', "export const planted = '<b>x</b>';", 'markup-string'],
    ['a markup template', 'export const planted = (x: string) => `</p>${x}`;', 'markup-string'],
    ['an innerHTML write', 'export const planted = (e: Element) => { e.innerHTML = "x"; };', 'innerHTML'],
    ['an insertAdjacentHTML call', "export const planted = (e: Element) => e.insertAdjacentHTML('beforeend', 'x');", 'insertAdjacentHTML'],
    ['a document.write call', "export const planted = () => document.write('x');", 'document.write'],
  ])('M4.EX2 planted: %s in exportMarkdown.tsx is red', (_name, text, rule) => {
    const dir = planted('src/docs/export/exportMarkdown.tsx', `\n${text}\n`);
    expect(scanSrc(dir, exportInertHits, exportInertScope)).toContain(`src/docs/export/exportMarkdown.tsx ${rule}`);
  });

  it.each([
    ['a markup string', "export const planted = '<b>x</b>';", 'markup-string'],
    ['a markup template', 'export const planted = (x: string) => `</p>${x}`;', 'markup-string'],
    ['an innerHTML write', 'export const planted = (e: Element) => { e.innerHTML = "x"; };', 'innerHTML'],
    ['an outerHTML write', 'export const planted = (e: Element) => { e.outerHTML = "x"; };', 'outerHTML'],
    ['an insertAdjacentHTML call', "export const planted = (e: Element) => e.insertAdjacentHTML('beforeend', 'x');", 'insertAdjacentHTML'],
    ['a document.write call', "export const planted = () => document.write('x');", 'document.write'],
  ])('M4.EX2 planted (Task 9): %s in the snapshot, exportMockup.ts, is red', (_name, text, rule) => {
    const dir = planted('src/docs/mockup/exportMockup.ts', `\n${text}\n`);
    expect(scanSrc(dir, exportInertHits, exportInertScope)).toContain(`src/docs/mockup/exportMockup.ts ${rule}`);
  });

  it('M4.EX2 (Task 9): the scope is the snapshot file, not its directory: the same markup string in mockup/load.ts is not this rule\'s', () => {
    const dir = planted('src/docs/mockup/load.ts', "\nexport const plantedMarkup = '<b>x</b>';\n");
    expect(scanSrc(dir, exportInertHits, exportInertScope)).toEqual([]);
    expect(exportInertScope('src/docs/mockup/load.ts')).toBe(false);
    expect(exportInertScope('src/docs/mockup/exportMockup.ts')).toBe(true);
    expect(exportInertScope('src/docs/mockup/exportMockup2.ts')).toBe(false);
  });

  it('M4.EX2: EXPORT_PREFIX is allowed by name, and only in policy.ts', () => {
    expect(exportInertHits("export const EXPORT_PREFIX = '<!doctype html>';", 'src/docs/export/policy.ts')).toEqual([]);
    expect(exportInertHits("export const EXPORT_PREFIX = '<!doctype html>';", 'src/docs/export/filename.ts'))
      .toEqual(['src/docs/export/filename.ts markup-string']);
  });

  it('M4.EX16 and M4.EX11: the builder, the blob, the pin rule and the frame have exactly their homes', () => {
    expect(scanSrc(PWA, exportUses)).toEqual([
      'src/docs/DocImage.tsx imagePinFor',
      'src/docs/ExportSheet.tsx buildExport:dynamic',
      'src/docs/ExportSheet.tsx downloadExport',
      'src/docs/MockupFrame.tsx iframe',
      'src/docs/MockupFrame.tsx srcDoc',
      'src/docs/docsLinks.ts imagePinFor',
      'src/docs/export/buildExport.tsx iframe',
      'src/docs/export/buildExport.tsx react-dom/server',
      'src/docs/export/buildExport.tsx renderToStaticMarkup',
      'src/docs/export/buildExport.tsx srcDoc',
      'src/docs/mockup/plan.ts imagePinFor',
      'src/docs/objectUrls.ts createObjectURL',
      'src/docs/objectUrls.ts new Blob',
      // The PDF frame (X2 P3, spec 2026-11-18 4.4): its one frame file, as the mockup's.
      'src/docs/pdf/PdfFrame.tsx iframe',
      'src/docs/pdf/PdfFrame.tsx srcDoc',
    ]);
  });

  it('M4.EX16: buildExport.tsx exports buildExport and types only', () => {
    const file = 'src/docs/export/buildExport.tsx';
    expect(exportedValues(readFileSync(path.join(PWA, file), 'utf8'), file)).toEqual(['buildExport']);
  });

  it.each([
    ['a static import of the builder in DocsHead', 'src/docs/DocsHead.tsx', "\nimport { buildExport as plantedBuild } from './export/buildExport';\nexport const plantedB = plantedBuild;\n", 'src/docs/DocsHead.tsx buildExport:static'],
    ['react-dom/server in exportMarkdown', 'src/docs/export/exportMarkdown.tsx', "\nimport { renderToString as plantedRender } from 'react-dom/server';\nexport const plantedR = plantedRender;\n", 'src/docs/export/exportMarkdown.tsx react-dom/server'],
    ['a bytes read in the sheet', 'src/docs/ExportSheet.tsx', '\nexport const plantedBytes = (r: { bytes: Uint8Array }) => r.bytes.length;\n', 'src/docs/ExportSheet.tsx bytes'],
    ['a window.open in the sheet', 'src/docs/ExportSheet.tsx', "\nexport const plantedOpen = () => window.open('x');\n", 'src/docs/ExportSheet.tsx window.open'],
    ['a Blob in the builder', 'src/docs/export/buildExport.tsx', "\nexport const plantedBlob = () => new Blob(['x']);\n", 'src/docs/export/buildExport.tsx new Blob'],
    ['an iframe in the builder', 'src/docs/export/buildExport.tsx', '\nexport const PlantedFrame = () => <iframe srcDoc="x" />;\n', 'src/docs/export/buildExport.tsx iframe'],
    ['imagePinFor in Export', 'src/docs/export/exportMarkdown.tsx', "\nimport { imagePinFor as plantedPin } from '../docsLinks';\nexport const plantedP = plantedPin;\n", 'src/docs/export/exportMarkdown.tsx imagePinFor'],
    ['imagePinFor in a mockup file other than the planner', 'src/docs/mockup/ports.ts', "\nimport { imagePinFor as plantedPin } from '../docsLinks';\nexport const plantedP = plantedPin;\n", 'src/docs/mockup/ports.ts imagePinFor'],
  ])('M4.EX16/M4.EX11 planted: %s is red', (_name, rel, text, use) => {
    expect(scanSrc(planted(rel, text), exportUses)).toContain(use);
  });

  it('M4.EX17: the builder reaches lib/markdown.tsx and neither highlight worker module nor highlight.js', () => {
    const { files, bare } = closureFrom(PWA, 'src/docs/export/buildExport');
    expect(files).toEqual(expect.arrayContaining([
      'src/docs/export/buildExport.tsx', 'src/lib/markdown.tsx', 'src/docs/DocImage.tsx', 'src/docs/mockup/exportMockup.ts',
    ]));
    expect(highlightModulesIn(files)).toEqual([]);
    expect(bare.filter((s) => namesHighlightJs('src/docs/export/buildExport.tsx', s))).toEqual([]);
  });

  it('M4.EX17 planted: highlight.js, or the grammars module, in a file the builder reaches is red', () => {
    const core = closureFrom(planted('src/docs/export/colouring.ts', "\nimport plantedCore from 'highlight.js/lib/core';\nexport const plantedC = plantedCore;\n"), 'src/docs/export/buildExport');
    expect(core.bare.filter((s) => namesHighlightJs('src/docs/export/colouring.ts', s))).not.toEqual([]);
    const grammars = closureFrom(planted('src/docs/export/exportMarkdown.tsx', "\nimport { HLJS as plantedG } from '../../lib/highlightGrammars';\nexport const plantedH = plantedG;\n"), 'src/docs/export/buildExport');
    expect(highlightModulesIn(grammars.files)).toContain('src/lib/highlightGrammars.ts');
  });

  it('M4.EX17 planted (Task 9): highlight.js, or the grammars module, in the snapshot the builder now reaches is red', () => {
    const core = closureFrom(planted('src/docs/mockup/exportMockup.ts', "\nimport plantedCore from 'highlight.js/lib/core';\nexport const plantedC = plantedCore;\n"), 'src/docs/export/buildExport');
    expect(core.bare.filter((s) => namesHighlightJs('src/docs/mockup/exportMockup.ts', s))).not.toEqual([]);
    const grammars = closureFrom(planted('src/docs/mockup/exportMockup.ts', "\nimport { HLJS as plantedG } from '../../lib/highlightGrammars';\nexport const plantedH = plantedG;\n"), 'src/docs/export/buildExport');
    expect(highlightModulesIn(grammars.files)).toContain('src/lib/highlightGrammars.ts');
  });

  it('M4.EX16 planted (Task 9): an iframe and a srcDoc in the viewer, a file other than the frame, are red', () => {
    // A `.ts` file cannot hold JSX, so the snapshot's own case is clause W8a's (its name arm reds a `srcDoc` identifier there).
    expect(exportUses('export const PlantedFrame = () => <iframe srcDoc="x" />;', 'src/docs/mockup/exportMockup.tsx'))
      .toEqual(['src/docs/mockup/exportMockup.tsx iframe', 'src/docs/mockup/exportMockup.tsx srcDoc']);
    expect(scanSrc(planted('src/docs/MockupView.tsx', '\nexport const PlantedFrame = () => <iframe srcDoc="x" />;\n'), exportUses))
      .toEqual(expect.arrayContaining(['src/docs/MockupView.tsx iframe', 'src/docs/MockupView.tsx srcDoc']));
  });

  it('M4.EX2 planted (pure source): the sink arm, outerHTML and document.writeln each report their rule', () => {
    const f = 'src/docs/export/exportMarkdown.tsx';
    expect(exportInertHits('export const planted = () => <p dangerouslySetInnerHTML={{ __html: "x" }} />;', f)).toContain(`${f} sink`);
    expect(exportInertHits('export const planted = (e: Element) => { e.outerHTML = "x"; };', f)).toContain(`${f} outerHTML`);
    expect(exportInertHits("export const planted = () => document.writeln('x');", f)).toContain(`${f} document.writeln`);
  });

  it('M4.EX16 planted (pure source): the sheet, new File and createObjectURL arms each report their rule', () => {
    const sheet = 'src/docs/ExportSheet.tsx';
    expect(exportUses('export const planted = (e: Element) => e.innerHTML;', sheet)).toContain(`${sheet} innerHTML`);
    expect(exportUses("export const planted = () => document.write('x');", sheet)).toContain(`${sheet} document.write`);
    expect(exportUses('export const Planted = () => <div srcDoc="x" />;', 'src/docs/DocsHead.tsx')).toContain('src/docs/DocsHead.tsx srcDoc');
    expect(exportUses("export const planted = () => new File(['x'], 'x');", 'src/docs/export/filename.ts')).toContain('src/docs/export/filename.ts new File');
    expect(exportUses("export const planted = () => URL.createObjectURL(new Blob(['x']));", 'src/docs/DocsHead.tsx'))
      .toContain('src/docs/DocsHead.tsx createObjectURL');
  });

  it('M4.EX17 planted: the highlight worker module in a file the builder reaches is red', () => {
    const worker = closureFrom(planted('src/docs/export/exportMarkdown.tsx', "\nimport { plantedW as plantedWorker } from '../../lib/markdownHighlightWorker';\nexport const plantedX = plantedWorker;\n"), 'src/docs/export/buildExport');
    expect(highlightModulesIn(worker.files)).toContain('src/lib/markdownHighlightWorker.ts');
  });

  it('M4.T7 Export clause: the badge scan reads the export files and finds no draft state', () => {
    const { files, hits } = scanTree([DOCS_DIR, DOCS_SCREEN], PWA);
    expect(files).toEqual(expect.arrayContaining(['src/docs/export/provenance.ts', 'src/docs/export/buildExport.tsx', 'src/docs/ExportSheet.tsx']));
    expect(hits).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Clause W5h-b, M4.H23 (base spec 2026-10-01 section 7.10): what the retirement of W5 part 1's main-thread highlight
// bounds keeps. (1) No `.ts`/`.tsx` file under `pwa/src` spells a retired limit, a part-1 helper or the
// whole word `part1` (case-sensitive), in its forms `part1`, `part1-scan`, `part1-markdown`, `part1-bounds`: read as
// TEXT, comments included, by whole word, because a retired name left in a comment is a name left behind. (2) The two
// caps on input crossing to the worker stay, at 65 536 and 524 288, and `lib/highlightStore.ts` reads each outside its
// import. (3) The xml grammar
// the worker registers carries no sub-language inside `<script>` or `<style>`; stock xml beside javascript and css is
// the control. Its imports are dynamic, inside the cases, so the clause leaves the file's import block as it is.
// NOT EXHAUSTIVE: a retired name built from pieces (`'MD_HIGHLIGHT_' + 'MAX_WORD_CHARS'`) is not seen; nor is one
// inside a longer identifier (`part1Bounds`), in another case (`Part1`), spelled with a `\u` escape, or in a `.css`
// file (not read).
// ---------------------------------------------------------------------------------------------------------------

/** Every name W5h-b retired, matched as a whole word. */
const RETIRED_WORDS: readonly string[] = [
  'MD_HIGHLIGHT_MAX_WORD_CHARS', 'MD_HIGHLIGHT_MAX_LINE_CHARS', 'MD_HIGHLIGHT_MAX_BLANK_CHARS', 'MD_HIGHLIGHT_JS_BLOCK_MAX_CHARS',
  'MD_HIGHLIGHT_RUST_BLOCK_MAX_CHARS', 'DOCS_HIGHLIGHT_SCAN_PAGE_MAX_CHARS', 'DOCS_HIGHLIGHT_MARKDOWN_PAGE_MAX_CHARS',
  'HIGHLIGHT_BOUNDED_CAPS', 'highlightBlockCap', 'boundedCap', 'inScanPageBudget', 'inMarkdownPageBudget', 'longestWordRun',
  'longestLine', 'longestBlankRun', 'deriveBoundedCaps', 'embeddedGrammars', 'part1',
];

/** Each retired word found in the source files under `<base>/src`, as `<file> <word>`. */
function retiredWordHits(base: string): string[] {
  const hits: string[] = [];
  for (const f of sourceFiles(path.join(base, 'src'))) {
    const text = readFileSync(f, 'utf8');
    const rel = path.relative(base, f).split(path.sep).join('/');
    for (const word of RETIRED_WORDS) if (new RegExp(`\\b${word}\\b`).test(text)) hits.push(`${rel} ${word}`);
  }
  return hits;
}

/** How many times each identifier occurs in one module outside its import declarations. */
function identifierUses(source: string, file: string): Map<string, number> {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const uses = new Map<string, number>();
  const visit = (n: ts.Node): void => {
    if (ts.isImportDeclaration(n)) return;
    if (ts.isIdentifier(n)) uses.set(n.text, (uses.get(n.text) ?? 0) + 1);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return uses;
}

// Its planted case copies the whole of pwa/src, so it takes the same bound as the clauses above, `TREE_COPY_TIMEOUT_MS`.
describe('clause W5h-b, M4.H23: what the retirement of part 1\'s highlight bounds keeps', { timeout: TREE_COPY_TIMEOUT_MS }, () => {
  const copies: string[] = [];
  afterAll(() => {
    for (const dir of copies) rmSync(dir, { recursive: true, force: true });
  });
  /** A copy of `pwa/src` with `text` appended to `rel`; returns the directory holding `src`. */
  function planted(rel: string, text: string): string {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'docs-scans-w5hb-'));
    copies.push(dir);
    cpSync(SRC_DIR, path.join(dir, 'src'), { recursive: true });
    const file = path.join(dir, ...rel.split('/'));
    writeFileSync(file, readFileSync(file, 'utf8') + text);
    return dir;
  }

  it('M4.H23: no retired limit, part-1 helper or part1 word is left anywhere in pwa/src', () => {
    expect(sourceFiles(SRC_DIR).length).toBeGreaterThan(100);
    expect(retiredWordHits(PWA)).toEqual([]);
  });

  it('M4.H23 planted: a retired limit declared again, a helper named in a comment, and a part1 word in a string are each red', () => {
    expect(retiredWordHits(planted('src/lib/markdownLimits.ts', '\nexport const MD_HIGHLIGHT_MAX_LINE_CHARS = 2048;\n')))
      .toEqual(['src/lib/markdownLimits.ts MD_HIGHLIGHT_MAX_LINE_CHARS']);
    expect(retiredWordHits(planted('src/lib/markdown.tsx', '\n// longestWordRun once bounded r10.\n')))
      .toEqual(['src/lib/markdown.tsx longestWordRun']);
    expect(retiredWordHits(planted('src/lib/highlightStore.ts', "\nexport const plantedSkip = 'part1-scan';\n")))
      .toEqual(['src/lib/highlightStore.ts part1']);
  });

  it('M4.H23: the two caps on input crossing to the worker stay, at 65 536 and 524 288, and highlightStore.ts reads each outside its import', async () => {
    const limits = await import('../src/lib/markdownLimits');
    expect(limits.MD_HIGHLIGHT_BLOCK_MAX_CHARS).toBe(65536);
    expect(limits.DOCS_HIGHLIGHT_PAGE_MAX_CHARS).toBe(524288);
    const uses = identifierUses(readFileSync(path.join(SRC_DIR, 'lib', 'highlightStore.ts'), 'utf8'), 'highlightStore.ts');
    expect(uses.get('MD_HIGHLIGHT_BLOCK_MAX_CHARS') ?? 0, 'MD_HIGHLIGHT_BLOCK_MAX_CHARS read').toBeGreaterThan(0);
    expect(uses.get('DOCS_HIGHLIGHT_PAGE_MAX_CHARS') ?? 0, 'DOCS_HIGHLIGHT_PAGE_MAX_CHARS read').toBeGreaterThan(0);
  });

  it('M4.H23: the worker\'s xml carries no sub-language inside <script> or <style>; stock xml beside javascript and css, the control, does', async () => {
    const { HLJS } = await import('../src/lib/highlightGrammars');
    const { default: hljs } = await import('highlight.js/lib/core');
    const { default: stockXml } = await import('highlight.js/lib/languages/xml');
    const { default: javascript } = await import('highlight.js/lib/languages/javascript');
    const { default: css } = await import('highlight.js/lib/languages/css');
    const src = '<script>let a = 1;</script><style>a { color: red }</style>';
    const SUB = /hljs-(?:keyword|selector-tag|attribute)/;
    const ours = HLJS.highlight(src, { language: 'xml', ignoreIllegals: true }).value;
    expect(ours).toMatch(/hljs-tag/);
    expect(ours).not.toMatch(SUB);
    expect(ours).not.toMatch(/class="language-/);
    const stock = hljs.newInstance();
    stock.registerLanguage('xml', stockXml);
    stock.registerLanguage('javascript', javascript);
    stock.registerLanguage('css', css);
    const control = stock.highlight(src, { language: 'xml', ignoreIllegals: true }).value;
    expect(control).toMatch(SUB);
    expect(control).toMatch(/class="language-javascript"/);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Clause C1 (native Docs reader, completion plan Task 5, C1; base spec 2026-10-01 5.6.2 and the DOMParser bullet of
// M5.16 as ruled for this wave). The HTML parser's entry points sit in ONE file, `src/docs/mockup/parse.ts`, and
// exactly once there: the native parse cannot be aborted, so the pre-scan is the only guard, and a second way into the
// parser would be a way round it. Across every `.ts` and `.tsx` file under `pwa/src`, TypeScript's parser finds:
//   (1) the identifier `DOMParser` in ANY position: `new DOMParser(`, a member name (`window.DOMParser`,
//       `globalThis.DOMParser`, `self.DOMParser`), a value alias (`const P = DOMParser`), an argument
//       (`Reflect.construct(DOMParser, [])`), a type reference, an import or a declaration. `Identifier.text` is the
//       unescaped name, so `new DOMParser()` is the same hit;
//   (2) a string or no-substitution template whose whole text is `DOMParser` (`globalThis['DOMParser']`,
//       `Reflect.get(globalThis, 'DOMParser')`);
//   (3) the member names `parseFromString`, `createHTMLDocument`, `createContextualFragment`, `parseHTMLUnsafe`,
//       `setHTMLUnsafe` and the Sanitizer API's `parseHTML` and `setHTML`, as an identifier in any position (a
//       property access, a property name, a method or a variable) or as a string key (`x['setHTMLUnsafe']`).
// In `src/docs/mockup/parse.ts` the ONLY allowed hits are one `new DOMParser(` whose callee is the bare identifier and
// one `.parseFromString(` member call; everything else, a second constructor, an alias, a string, is red, and the
// allowance is that one file by exact path, never a directory (a parser in `src/docs/mockup/prescan.ts` is red).
// The draft review page (X3, wave R2 Task R2.1, D-8767) is the one other home: `src/review/main.ts` may hold exactly one
// `new DOMParser(` and one `.parseFromString(` too (its inert parse of the copy's bytes for "Links in this copy"), each
// counted on its own, by exact path (a parser in `src/review/other.ts` is red).
// NOT EXHAUSTIVE. Known evasions it does not see: a name built at run time (`'DOM' + 'Parser'`, a template with a
// substitution); `eval` and `new Function`; a re-export through a file outside `pwa/src`; `Reflect.get` with a key held
// in a variable; and the writes that parse without these names (`innerHTML`, `outerHTML`, `insertAdjacentHTML` and
// `document.write`), which this census does not read: the W5h-a clause's note names the same, and its sink clause and
// Export's M4.EX2 hold those; and an `XMLHttpRequest` with `responseType = 'document'`, which parses a response as HTML
// through no name this census lists. Review lens 4 reads for them.
// ---------------------------------------------------------------------------------------------------------------

const PARSER_HOME = 'src/docs/mockup/parse.ts';
/** The draft review page's entry: the second home, by exact path (X3 R2.1, D-8767). */
const REVIEW_PARSER_HOME = 'src/review/main.ts';
/** Every file that may hold the one constructor and the one parse call, each counted on its own. */
const PARSER_HOMES: readonly string[] = [PARSER_HOME, REVIEW_PARSER_HOME];
const PARSER_MEMBERS: readonly string[] = [
  'parseFromString', 'createHTMLDocument', 'createContextualFragment', 'parseHTMLUnsafe', 'setHTMLUnsafe', 'parseHTML', 'setHTML',
];

/** Every parser entry point in one module, as `<file> <label>`: `new DOMParser(` (a bare-identifier callee), `DOMParser`
 *  (any other identifier), `'<name>'` (a string or template of exactly that name), `.<member>(` (a member call of one of
 *  the five names) and `<member>` (the name in any other position). */
function parserHits(source: string, file: string): string[] {
  const hits: string[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isIdentifier(n)) {
      const p = n.parent;
      if (n.text === 'DOMParser') hits.push(`${file} ${ts.isNewExpression(p) && p.expression === n ? 'new DOMParser(' : 'DOMParser'}`);
      else if (PARSER_MEMBERS.includes(n.text)) {
        const call = ts.isPropertyAccessExpression(p) && p.name === n && ts.isCallExpression(p.parent) && p.parent.expression === p;
        hits.push(`${file} ${call ? `.${n.text}(` : n.text}`);
      }
    } else if (isPlainString(n) && (n.text === 'DOMParser' || PARSER_MEMBERS.includes(n.text))) hits.push(`${file} '${n.text}'`);
    ts.forEachChild(n, visit);
  };
  visit(parse(source, file));
  return hits;
}

/** The census over a set of sources (path relative to `pwa`, `/` separators): what is left after each home's own
 *  allowance (the first `new DOMParser(` and the first `.parseFromString(` in parse.ts, and the same in the review
 *  page's main.ts), and how much of it was found. */
function parserCensus(sources: ReadonlyMap<string, string>): { hits: string[]; allowed: number } {
  const hits: string[] = [];
  let allowed = 0;
  const spent = new Set<string>();
  for (const [file, source] of [...sources].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    for (const hit of parserHits(source, file)) {
      const label = hit.slice(file.length + 1);
      if (PARSER_HOMES.includes(file) && (label === 'new DOMParser(' || label === '.parseFromString(') && !spent.has(`${file} ${label}`)) {
        spent.add(`${file} ${label}`);
        allowed += 1;
      } else hits.push(hit);
    }
  }
  return { hits, allowed };
}

/** Every `.ts` and `.tsx` source under `<base>/src`, by its path relative to `base`. */
function treeSources(base: string): Map<string, string> {
  return new Map(sourceFiles(path.join(base, 'src')).map((f) => [path.relative(base, f).split(path.sep).join('/'), readFileSync(f, 'utf8')] as const));
}

describe('clause C1: the HTML parser has one home, one constructor and one parse call (M5.16, the DOMParser bullet)', { timeout: TREE_COPY_TIMEOUT_MS }, () => {
  const real = treeSources(PWA);
  /** The real tree with `text` appended to `rel` (created when it is absent). */
  const planted = (rel: string, text: string): ReadonlyMap<string, string> => new Map([...real, [rel, `${real.get(rel) ?? ''}${text}`]]);
  const copies: string[] = [];
  afterAll(() => {
    for (const dir of copies) rmSync(dir, { recursive: true, force: true });
  });

  it('the real tree has exactly the allowance and no other hit: parse.ts and the review page each hold one constructor and one parse call', () => {
    expect(real.size).toBeGreaterThan(100);
    expect(real.has(PARSER_HOME)).toBe(true);
    expect(real.has(REVIEW_PARSER_HOME)).toBe(true);
    expect(parserCensus(real)).toEqual({ hits: [], allowed: 4 });
  });

  it('a planted file in a COPY of the tree on disk is found by the same read', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'docs-scans-c1-'));
    copies.push(dir);
    cpSync(SRC_DIR, path.join(dir, 'src'), { recursive: true });
    const file = path.join(dir, 'src', 'docs', 'DocsLeaf.tsx');
    writeFileSync(file, `${readFileSync(file, 'utf8')}\nexport const plantedParser = () => new DOMParser();\n`);
    expect(parserCensus(treeSources(dir)).hits).toEqual(['src/docs/DocsLeaf.tsx new DOMParser(']);
  });

  const LEAF = 'src/docs/DocsLeaf.tsx';
  it.each([
    ['new DOMParser() in another file', 'export const planted = () => new DOMParser();', 'new DOMParser('],
    ['new window.DOMParser()', 'export const planted = () => new window.DOMParser();', 'DOMParser'],
    ['new globalThis.DOMParser() and new self.DOMParser()', 'export const planted = () => [new globalThis.DOMParser(), new self.DOMParser()];', 'DOMParser|DOMParser'],
    ["new globalThis['DOMParser']()", "export const planted = () => new globalThis['DOMParser']();", "'DOMParser'"],
    ['a template-literal key', 'export const planted = () => new globalThis[`DOMParser`]();', "'DOMParser'"],
    ['an alias: const P = DOMParser; new P()', 'const P = DOMParser;\nexport const planted = () => new P();', 'DOMParser'],
    ['Reflect.construct(DOMParser, [])', 'export const planted = () => Reflect.construct(DOMParser, []);', 'DOMParser'],
    ['the unicode-escaped new \\u0044OMParser()', 'export const planted = () => new \\u0044OMParser();', 'new DOMParser('],
    ["Reflect.get(globalThis, 'DOMParser')", "export const planted = () => Reflect.get(globalThis, 'DOMParser');", "'DOMParser'"],
    ['a type reference', 'export type PlantedParser = DOMParser;', 'DOMParser'],
    ['parseFromString alone', "export const planted = (p: P) => p.parseFromString('', 'text/html');", '.parseFromString('],
    ['createHTMLDocument alone', "export const planted = () => document.implementation.createHTMLDocument('');", '.createHTMLDocument('],
    ['createContextualFragment alone', "export const planted = (r: Range) => r.createContextualFragment('');", '.createContextualFragment('],
    ['parseHTMLUnsafe alone', "export const planted = () => (Document as D).parseHTMLUnsafe('');", '.parseHTMLUnsafe('],
    ['setHTMLUnsafe alone', "export const planted = (e: Element) => (e as E).setHTMLUnsafe('');", '.setHTMLUnsafe('],
    ['parseHTML alone (the Sanitizer API)', "export const planted = (e: E) => (e as S).parseHTML('');", '.parseHTML('],
    ['setHTML alone (the Sanitizer API)', "export const planted = (e: Element) => (e as E).setHTML('');", '.setHTML('],
    ["a member name as an element-access key: x['setHTMLUnsafe']", "export const planted = (e: E) => e['setHTMLUnsafe']('');", "'setHTMLUnsafe'"],
    ['a member name as a property name', 'export const planted = { createHTMLDocument: 1 };', 'createHTMLDocument'],
  ])('planted: %s is red, with its exact hit', (_name, text, labels) => {
    const expected = labels.split('|').map((l) => `${LEAF} ${l}`).sort();
    expect(parserCensus(planted(LEAF, `\n${text}\n`)).hits).toEqual(expected);
  });

  it('planted: the home file with the other extension (parse.tsx) is not the allowance', () => {
    expect(parserCensus(planted('src/docs/mockup/parse.tsx', 'export const p = () => new DOMParser();\n')).hits)
      .toEqual(['src/docs/mockup/parse.tsx new DOMParser(']);
  });

  it('planted: the allowance widened to a directory: a parser in src/docs/mockup/prescan.ts is red', () => {
    expect(parserCensus(planted('src/docs/mockup/prescan.ts', '\nexport const planted = () => new DOMParser();\n')).hits)
      .toEqual(['src/docs/mockup/prescan.ts new DOMParser(']);
  });

  it.each([
    ['a second new DOMParser()', 'export const second = () => new DOMParser();', 'new DOMParser('],
    ['an alias', 'const P = DOMParser;\nexport const second = () => new P();', 'DOMParser'],
    ['a second parseFromString call', "export const second = (p: P) => p.parseFromString('', 'text/html');", '.parseFromString('],
    ['a string', "export const second = 'DOMParser';", "'DOMParser'"],
    ['Reflect.construct', 'export const second = () => Reflect.construct(DOMParser, []);', 'DOMParser'],
    ['another entry point', "export const second = (r: Range) => r.createContextualFragment('');", '.createContextualFragment('],
  ])('planted in parse.ts itself: %s is red beyond the allowance', (_name, text, label) => {
    const answer = parserCensus(planted(PARSER_HOME, `\n${text}\n`));
    expect(answer.hits).toEqual([`${PARSER_HOME} ${label}`]);
    expect(answer.allowed).toBe(4);
  });

  it.each([
    ['a second new DOMParser()', 'export const second = () => new DOMParser();', 'new DOMParser('],
    ['an alias', 'const P = DOMParser;\nexport const second = () => new P();', 'DOMParser'],
    ['a second parseFromString call', "export const second = (p: P) => p.parseFromString('', 'text/html');", '.parseFromString('],
    ['a string', "export const second = 'DOMParser';", "'DOMParser'"],
    ['another entry point', "export const second = (r: Range) => r.createContextualFragment('');", '.createContextualFragment('],
  ])('planted in the review page itself: %s is red beyond its allowance (R2.1)', (_name, text, label) => {
    const answer = parserCensus(planted(REVIEW_PARSER_HOME, `\n${text}\n`));
    expect(answer.hits).toEqual([`${REVIEW_PARSER_HOME} ${label}`]);
    expect(answer.allowed).toBe(4);
  });

  it('planted: the review page allowance is main.ts by exact path: a parser in src/review/other.ts or main.tsx is red (R2.1)', () => {
    expect(parserCensus(planted('src/review/other.ts', 'export const p = () => new DOMParser();\nexport const q = (p: P) => p.parseFromString(\'\', \'text/html\');\n')).hits)
      .toEqual(['src/review/other.ts new DOMParser(', 'src/review/other.ts .parseFromString(']);
    expect(parserCensus(planted('src/review/main.tsx', 'export const p = () => new DOMParser();\n')).hits)
      .toEqual(['src/review/main.tsx new DOMParser(']);
  });

  it('the allowance is counted, not assumed: a parse.ts with no constructor and no parse call finds none of it', () => {
    expect(parserCensus(new Map([...real, [PARSER_HOME, 'export const nothing = 1;\n']]))).toEqual({ hits: [], allowed: 2 });
    expect(parserCensus(new Map([...real, [REVIEW_PARSER_HOME, 'export const nothing = 1;\n']]))).toEqual({ hits: [], allowed: 2 });
  });

  it.each([
    ['a comment', '// new DOMParser() and parseFromString\nexport const x = 1;'],
    ['a block comment', '/* DOMParser.parseFromString */\nexport const x = 1;'],
    ['a string that only mentions it', "export const x = 'a DOMParser here';"],
    ['a member of another name', "export const x = (p: P) => p.parseFromStrings('') + p.DOMParsers;"],
    ['the lower-case name', 'export const x = (domParser: D) => domParser;'],
  ])('does not count %s', (_name, source) => {
    expect(parserHits(source, 'planted.ts')).toEqual([]);
  });

  it.each([
    ['a name built by concatenation', "export const x = globalThis['DOM' + 'Parser'];"],
    ['a template with a substitution', 'export const x = globalThis[`DOM${"Parser"}`];'],
    ['eval', "export const x = () => eval('new DOMParser()');"],
    ['new Function', "export const x = () => new Function('return new DOMParser()');"],
  ])('known evasion, not seen (the header says not exhaustive): %s', (_name, source) => {
    expect(parserHits(source, 'planted.ts')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Clause C1 origins (native Docs reader, completion plan Task 7, C1 fix round 1, review run 2259's A4). An
// `HttpsOrigin` is the only value `mockupCsp` appends to the frame's policy, and its type promises it was accepted by
// `parseMockupOrigin` (https, the LDH host grammar, no IP literal, no `localhost`, not the console's own host). The
// promise is a brand, so a cast anywhere else would put an unchecked origin into the CSP. Across every `.ts` and `.tsx`
// file under `pwa/src`, TypeScript's parser finds each type assertion whose type names `HttpsOrigin` anywhere inside it
// (`x as HttpsOrigin`, `<HttpsOrigin>x`, `x as unknown as HttpsOrigin`, and since fix round 2 (review run 2281 F2) the
// array, readonly array, `Array<>`, `ReadonlyArray<>` and union forms, `xs as readonly HttpsOrigin[]`,
// `x as HttpsOrigin | null`: the only sinks take arrays), and the only one allowed is a single assertion inside the function
// `parseMockupOrigin` in `src/docs/mockup/origins.ts`.
// NOT EXHAUSTIVE: an alias of the type (`type H = HttpsOrigin`), a structural object literal of the brand's shape, a
// generic helper that casts to its type parameter, and `any` flowing into an `HttpsOrigin` slot are not seen.
// ---------------------------------------------------------------------------------------------------------------

const ORIGIN_HOME = 'src/docs/mockup/origins.ts';

/** Every assertion to `HttpsOrigin` in one module, as `<file> <enclosing function or (top level)>`. */
function originCasts(source: string, file: string): string[] {
  const hits: string[] = [];
  /** Whether the type node names `HttpsOrigin` anywhere inside it (an element type, a type argument, a union member). */
  const named = (t: ts.Node): boolean =>
    (ts.isTypeReferenceNode(t) && ts.isIdentifier(t.typeName) && t.typeName.text === 'HttpsOrigin')
    || (ts.forEachChild(t, (c) => (named(c) ? true : undefined)) ?? false);
  const enclosing = (n: ts.Node): string => {
    for (let p: ts.Node | undefined = n.parent; p !== undefined; p = p.parent) {
      if (ts.isFunctionDeclaration(p) && p.name !== undefined) return p.name.text;
      if ((ts.isArrowFunction(p) || ts.isFunctionExpression(p)) && ts.isVariableDeclaration(p.parent) && ts.isIdentifier(p.parent.name)) {
        return p.parent.name.text;
      }
      if (ts.isMethodDeclaration(p) && ts.isIdentifier(p.name)) return p.name.text;
    }
    return '(top level)';
  };
  const visit = (n: ts.Node): void => {
    if ((ts.isAsExpression(n) || ts.isTypeAssertionExpression(n)) && named(n.type)) hits.push(`${file} ${enclosing(n)}`);
    ts.forEachChild(n, visit);
  };
  visit(parse(source, file));
  return hits;
}

/** What is left after the one allowed assertion (the first in `parseMockupOrigin` in origins.ts), and how much was. */
function originCensus(sources: ReadonlyMap<string, string>): { hits: string[]; allowed: number } {
  const hits: string[] = [];
  let allowed = 0;
  for (const [file, source] of [...sources].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    for (const hit of originCasts(source, file)) {
      if (allowed === 0 && hit === `${ORIGIN_HOME} parseMockupOrigin`) allowed += 1;
      else hits.push(hit);
    }
  }
  return { hits, allowed };
}

describe('clause C1 origins: an HttpsOrigin is made only in parseMockupOrigin (M5.21, fix round 1 A4)', { timeout: 30_000 }, () => {
  const real = treeSources(PWA);
  const planted = (rel: string, text: string): ReadonlyMap<string, string> => new Map([...real, [rel, `${real.get(rel) ?? ''}${text}`]]);

  it('the real tree has exactly the one assertion, inside parseMockupOrigin', () => {
    expect(real.has(ORIGIN_HOME)).toBe(true);
    expect(originCensus(real)).toEqual({ hits: [], allowed: 1 });
  });

  it.each([
    ['a cast in policy.ts', 'src/docs/mockup/policy.ts', "export const planted = 'https://a.example' as HttpsOrigin;", 'src/docs/mockup/policy.ts (top level)'],
    ['a double cast in load.ts', 'src/docs/mockup/load.ts', "export const planted = (s: string) => s as unknown as HttpsOrigin;", 'src/docs/mockup/load.ts planted'],
    ['an angle-bracket assertion', 'src/docs/mockup/policy.ts', "export function planted(s: string) { return <HttpsOrigin>s; }", 'src/docs/mockup/policy.ts planted'],
    ['a second cast in origins.ts outside the function', ORIGIN_HOME, "export const planted = (s: string) => s as HttpsOrigin;", `${ORIGIN_HOME} planted`],
    ['a cast in another Docs file', 'src/docs/DocsLeaf.tsx', "export const planted = (s: string) => s as HttpsOrigin;", 'src/docs/DocsLeaf.tsx planted'],
    ['a readonly array cast', 'src/docs/mockup/policy.ts', "export const planted = (xs: string[]) => xs as readonly HttpsOrigin[];", 'src/docs/mockup/policy.ts planted'],
    ['a union cast', 'src/docs/mockup/policy.ts', "export const planted = (s: string) => s as HttpsOrigin | null;", 'src/docs/mockup/policy.ts planted'],
    ['an array cast', 'src/docs/mockup/load.ts', "export const planted = (xs: string[]) => xs as HttpsOrigin[];", 'src/docs/mockup/load.ts planted'],
    ['an Array<> cast', 'src/docs/mockup/load.ts', "export const planted = (xs: string[]) => xs as Array<HttpsOrigin>;", 'src/docs/mockup/load.ts planted'],
    ['an as-unknown array cast', 'src/docs/mockup/load.ts', "export const planted = (xs: string[]) => xs as unknown as readonly HttpsOrigin[];", 'src/docs/mockup/load.ts planted'],
    ['a ReadonlyArray<> cast', 'src/docs/mockup/load.ts', "export const planted = (xs: string[]) => xs as ReadonlyArray<HttpsOrigin>;", 'src/docs/mockup/load.ts planted'],
  ])('planted: %s is red', (_name, rel, text, hit) => {
    expect(originCensus(planted(rel, `\n${text}\n`))).toEqual({ hits: [hit], allowed: 1 });
  });

  it('the allowance is counted, not assumed: an origins.ts without the cast finds none', () => {
    expect(originCensus(new Map([...real, [ORIGIN_HOME, 'export const nothing = 1;\n']]))).toEqual({ hits: [], allowed: 0 });
  });

  it('does not count a mention in a comment, a string or a type annotation', () => {
    expect(originCasts("// x as HttpsOrigin\nexport const a = 'as HttpsOrigin';\nexport const f = (o: HttpsOrigin): HttpsOrigin => o;\n", 'p.ts')).toEqual([]);
  });
});
