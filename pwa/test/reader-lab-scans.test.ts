// What the reader lab never does (native Docs reader, the reader lab plan of 2026-11-03, Task 11; the rich-docs spec's
// rows M10.9, M10.12, M10.15; the reader lab design, section 7), read with TypeScript's parser, each rule with planted
// controls on a file's own text:
//   1. The lab's modules (`screens/ReaderLab.tsx`, `docs/reader/labPolicy.ts`, every file under `readerLab/`) import no
//      `lib/storage`, name no `localStorage`, `sessionStorage`, `indexedDB` or `caches`, read no `clipboard`, call no
//      `fetch`, `sendBeacon`, `postMessage` or `window.open`, name no `XMLHttpRequest`, `WebSocket`, `EventSource` or
//      `MessageChannel`, `BroadcastChannel`, `MessagePort`, `Worker` or `SharedWorker`, access no `onmessage` member,
//      read `api` only as `api.readerLab`, and spell no URL but the SVG namespace. The frame scripts' TEXT names several
//      of these on purpose; it runs only inside opaque frames, and a string is not an identifier.
//   2. Outside `pwa/src/docs` (whose own clause W8a holds that tree), an iframe or a srcdoc is built in
//      `readerLab/frames.ts` and in the draft review page's entry, `review/main.ts` (X3 R2.1, D-8767), by exact path
//      and never the directory: the same frame in `review/other.ts` is red.
//   3. No string in `pwa/src` holds a sandbox token beyond `allow-scripts`, and `frames.ts` sets `sandbox` only from
//      `LAB_SANDBOX`. The review page's `main.ts` sets it to the empty string literal only,
//      `setAttribute('sandbox', '')` (the strictest sandbox, so no frame gains a permission): any other value there,
//      and the empty string anywhere else in `review/`, is red.
//   4. `'lab-draw'` is spelled only in `docs/reader/policy.ts` and `readerLab/run.ts`.
// NOT EXHAUSTIVE. Dynamically computed members, `globalThis[…]`, `eval` and names built from pieces can evade these
// checks; the held-out review reads for them, and the browser case checks what the frames do.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { ts } from '../../server/test/scan/parse';
import { describe, expect, it } from 'vitest';

const PWA = path.join(import.meta.dirname, '..');
const SRC = path.join(PWA, 'src');
const SVG_NS = 'http://www.w3.org/2000/svg';
const FRAME_HOME = 'src/readerLab/frames.ts';
/** The draft review page's entry (X3 R2.1, D-8767): the one other file that builds a frame, by exact path. */
const REVIEW_HOME = 'src/review/main.ts';
/** The measurement fixture's data module (X3 R2.3, D-8767): Export's own copies as string constants, whose TEXT holds
 *  `<iframe sandbox="" srcdoc=...>` (the mockup wrapper's nested frame). By exact path, never the directory. */
const LAB_FIXTURE_HOME = 'src/review/labFixture.ts';
const FRAME_HOMES: readonly string[] = [FRAME_HOME, REVIEW_HOME, LAB_FIXTURE_HOME];
const LAB_DRAW_HOMES: readonly string[] = ['src/docs/reader/policy.ts', 'src/readerLab/run.ts'];
const FORBIDDEN_SANDBOX = /\ballow-(?:same-origin|popups|top-navigation|forms|modals|downloads|pointer-lock|presentation|orientation-lock|storage-access)/;

/** Every `.ts` and `.tsx` file under `root`, sorted. */
function sourceFiles(root: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(root).sort()) {
    const p = path.join(root, name);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}
const rel = (abs: string): string => path.relative(PWA, abs).split(path.sep).join('/');
const read = (r: string): string => readFileSync(path.join(PWA, ...r.split('/')), 'utf8');
const ALL = (): string[] => sourceFiles(SRC).map(rel);
const LAB_MODULES = (): string[] => ['src/screens/ReaderLab.tsx', 'src/docs/reader/labPolicy.ts', ...sourceFiles(path.join(SRC, 'readerLab')).map(rel)];

const parse = (source: string, file: string): ts.SourceFile =>
  ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
function unwrap(n: ts.Expression): ts.Expression {
  let e = n;
  while (ts.isParenthesizedExpression(e) || ts.isNonNullExpression(e) || ts.isAsExpression(e)
    || ts.isSatisfiesExpression(e) || ts.isTypeAssertionExpression(e)) e = e.expression;
  return e;
}
function memberName(n: ts.Node): string | undefined {
  if (ts.isPropertyAccessExpression(n)) return n.name.text;
  if (ts.isElementAccessExpression(n) && (ts.isStringLiteral(n.argumentExpression) || ts.isNoSubstitutionTemplateLiteral(n.argumentExpression))) {
    return n.argumentExpression.text;
  }
  return undefined;
}
const stringText = (n: ts.Node): string | undefined =>
  (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n))
    ? n.text : undefined;
const walk = (sf: ts.SourceFile, f: (n: ts.Node) => void): void => {
  const visit = (n: ts.Node): void => { f(n); ts.forEachChild(n, visit); };
  visit(sf);
};

/** Rule 1, on one lab module. */
function labFindings(source: string, file: string): string[] {
  const out = new Set<string>();
  walk(parse(source, file), (n) => {
    if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier !== undefined && ts.isStringLiteral(n.moduleSpecifier)
      && /(?:^|\/)lib\/storage$/.test(n.moduleSpecifier.text)) out.add('storage');
    if (ts.isIdentifier(n) && ['localStorage', 'sessionStorage', 'indexedDB', 'caches'].includes(n.text)) out.add('storage');
    if (ts.isIdentifier(n) && ['XMLHttpRequest', 'WebSocket', 'EventSource', 'MessageChannel', 'BroadcastChannel', 'MessagePort', 'Worker', 'SharedWorker'].includes(n.text)) out.add('channel');
    if ((ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n)) && memberName(n) === 'onmessage') out.add('onmessage');
    if ((ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n)) && memberName(n) === 'clipboard') out.add('clipboard');
    if (ts.isCallExpression(n)) {
      const callee = unwrap(n.expression);
      const name = ts.isIdentifier(callee) ? callee.text : memberName(callee);
      if (name === 'fetch' || name === 'sendBeacon') out.add('fetch');
      if (name === 'postMessage') out.add('postMessage');
      if (name === 'open' && (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee))) {
        const owner = unwrap(callee.expression);
        if (ts.isIdentifier(owner) && owner.text === 'window') out.add('window.open');
      }
    }
    if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'api' && n.name.text !== 'readerLab') out.add('api');
    const text = stringText(n);
    if (text !== undefined) {
      for (const m of text.matchAll(/[a-z][a-z0-9+.-]*:\/\/[^\s'"`)]*/gi)) if (m[0] !== SVG_NS) out.add('url');
    }
  });
  return [...out].sort().map((r) => `${file} ${r}`);
}

/** Rule 2, on any file outside `src/docs`; `ignoreHome` reads the frame home too (the anti-vacuity half). */
function frameFindings(source: string, file: string, ignoreHome = false): string[] {
  if (file.startsWith('src/docs/') || (FRAME_HOMES.includes(file) && !ignoreHome)) return [];
  const out = new Set<string>();
  walk(parse(source, file), (n) => {
    if (ts.isIdentifier(n) && n.text.toLowerCase() === 'srcdoc') out.add('srcdoc');
    if ((ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) && ts.isIdentifier(n.tagName) && n.tagName.text === 'iframe') out.add('iframe');
    if (ts.isCallExpression(n) && memberName(unwrap(n.expression)) === 'createElement' && n.arguments[0] !== undefined
      && stringText(n.arguments[0])?.toLowerCase() === 'iframe') out.add('iframe');
    const text = stringText(n);
    if (text !== undefined && /<iframe/i.test(text)) out.add('iframe');
    if (text !== undefined && /srcdoc/i.test(text)) out.add('srcdoc');
  });
  return [...out].sort().map((r) => `${file} ${r}`);
}

/** Rule 3, on any file. */
function sandboxFindings(source: string, file: string): string[] {
  const out = new Set<string>();
  walk(parse(source, file), (n) => {
    const text = stringText(n);
    if (text !== undefined && FORBIDDEN_SANDBOX.test(text)) out.add('token');
    if (ts.isCallExpression(n) && memberName(unwrap(n.expression)) === 'setAttribute' && n.arguments[0] !== undefined
      && stringText(n.arguments[0]) === 'sandbox') {
      const v = n.arguments[1];
      const allowed = file === REVIEW_HOME
        ? v !== undefined && ts.isStringLiteral(v) && v.text === ''
        : v !== undefined && ts.isIdentifier(v) && v.text === 'LAB_SANDBOX';
      if (!allowed) out.add('sandbox-value');
    }
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && memberName(unwrap(n.left)) === 'sandbox') out.add('sandbox-value');
  });
  return [...out].sort().map((r) => `${file} ${r}`);
}

/** Rule 4, on any file. */
function labDrawFindings(source: string, file: string): string[] {
  let hits = 0;
  walk(parse(source, file), (n) => { if (stringText(n) === 'lab-draw') hits += 1; });
  return hits > 0 && !LAB_DRAW_HOMES.includes(file) ? [`${file} lab-draw`] : [];
}

const planted = (file: string, text: string, f: (s: string, file: string) => string[]): string[] => f(`${read(file)}\n${text}\n`, file);

const GAP_CALLERS = ['src/screens/highlightMeasureRun.tsx', 'src/readerLab/run.ts'] as const;
/** The two callers share one imported measure. A loop that awaits, subtracts and takes a maximum is a second measure.
 * This is a structural tripwire, not a proof against computed or deliberately disguised alternatives. */
function gapFindings(source: string, file: string): string[] {
  let imported = false;
  let called = false;
  let inline = false;
  walk(parse(source, file), (n) => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier) && n.moduleSpecifier.text === '../lib/frameGap'
      && n.importClause !== undefined && !n.importClause.isTypeOnly && n.importClause.namedBindings !== undefined
      && ts.isNamedImports(n.importClause.namedBindings)) {
      imported ||= n.importClause.namedBindings.elements.some((e) => !e.isTypeOnly && e.name.text === 'longestFrameGap'
        && (e.propertyName === undefined || e.propertyName.text === 'longestFrameGap'));
    }
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'longestFrameGap') called = true;
    if (ts.isWhileStatement(n) || ts.isDoStatement(n) || ts.isForStatement(n) || ts.isForOfStatement(n) || ts.isForInStatement(n)) {
      let awaits = false;
      let subtracts = false;
      let maximum = false;
      const visit = (child: ts.Node): void => {
        if (ts.isAwaitExpression(child)) awaits = true;
        if (ts.isBinaryExpression(child) && child.operatorToken.kind === ts.SyntaxKind.MinusToken) subtracts = true;
        if (ts.isCallExpression(child) && ts.isPropertyAccessExpression(child.expression)
          && ts.isIdentifier(child.expression.expression) && child.expression.expression.text === 'Math' && child.expression.name.text === 'max') maximum = true;
        ts.forEachChild(child, visit);
      };
      visit(n.statement);
      if (awaits && subtracts && maximum) inline = true;
    }
  });
  return [...(!imported ? [`${file} missing import`] : []), ...(!called ? [`${file} missing call`] : []),
    ...(inline ? [`${file} inline frame-gap loop`] : [])];
}
const DUPLICATE_GAP = `async function duplicate(frame: () => Promise<number>, done: () => boolean) {
  let last = await frame(), gap = 0;
  while (!done()) { const t = await frame(); gap = Math.max(gap, t - last); last = t; }
  return gap;
}`;

describe('the shared frame-gap measure', () => {
  it.each(GAP_CALLERS)('%s imports and calls the shared measure without an inline loop', (file) => {
    expect(gapFindings(read(file), file)).toEqual([]);
  });
  it.each(GAP_CALLERS)('%s planted missing import and call are detected', (file) => {
    const source = read(file);
    const withoutImport = source.replace("import { longestFrameGap } from '../lib/frameGap';", '');
    expect(withoutImport).not.toBe(source);
    expect(gapFindings(withoutImport, file)).toContain(`${file} missing import`);
    const withoutCalls = source.replaceAll('longestFrameGap(', 'otherGap(');
    expect(withoutCalls).not.toBe(source);
    expect(gapFindings(withoutCalls, file)).toContain(`${file} missing call`);
  });
  it.each(GAP_CALLERS)('%s planted duplicate gap loop is detected with import retained', (file) => {
    expect(gapFindings(`${read(file)}\n${DUPLICATE_GAP}`, file)).toContain(`${file} inline frame-gap loop`);
  });
});

describe('what the reader lab never does (reader lab plan, Task 11)', () => {
  it('the lab modules exist and are read', () => {
    const files = LAB_MODULES();
    expect(files).toEqual(expect.arrayContaining(['src/screens/ReaderLab.tsx', 'src/docs/reader/labPolicy.ts', 'src/readerLab/run.ts',
      'src/readerLab/frames.ts', 'src/readerLab/frameScripts.ts', 'src/readerLab/battery.ts', 'src/readerLab/verdicts.ts']));
    expect(read('src/readerLab/run.ts')).toContain('api.readerLab');
  });

  it('rule 1: the lab modules store nothing, copy nothing, request nothing of their own, read api only as readerLab, and spell no URL (M10.12)', () => {
    expect(LAB_MODULES().flatMap((f) => labFindings(read(f), f))).toEqual([]);
  });

  it.each([
    ['a storage read', "export const planted = () => localStorage.length;", 'storage'],
    ['the storage owner', "import { pageStorage } from '../lib/storage';\nexport const planted = pageStorage;", 'storage'],
    ['a clipboard write', "export const planted = () => navigator.clipboard.writeText('x');", 'clipboard'],
    ['a fetch of its own', "export const planted = () => fetch('/api/x');", 'fetch'],
    ['a beacon', "export const planted = () => navigator.sendBeacon('/api/x', 'x');", 'fetch'],
    ['a port', 'export const planted = () => new MessageChannel();', 'channel'],
    ['a broadcast channel', 'export const planted = () => new BroadcastChannel();', 'channel'],
    ['a message port', 'export const planted = () => MessagePort;', 'channel'],
    ['a worker', 'export const planted = () => Worker;', 'channel'],
    ['a shared worker', 'export const planted = () => SharedWorker;', 'channel'],
    ['an onmessage property', 'export const planted = () => target.onmessage;', 'onmessage'],
    ['an onmessage element', "export const planted = () => target['onmessage'];", 'onmessage'],
    ['a post', "export const planted = () => window.parent.postMessage('x', '*');", 'postMessage'],
    ['another api read', 'export const planted = () => api.docs;', 'api'],
    ['a URL of its own', "export const planted = 'https://elsewhere.example/x';", 'url'],
    ['a popup', "export const planted = () => window.open('/x');", 'window.open'],
  ])('rule 1 planted: %s in the run module is red', (_name, text, rule) => {
    expect(planted('src/readerLab/run.ts', text, labFindings)).toEqual([`src/readerLab/run.ts ${rule}`]);
  });

  it('rule 2: outside the Docs reader, only readerLab/frames.ts builds an iframe or a srcdoc, and it does (M10.9)', () => {
    expect(ALL().flatMap((f) => frameFindings(read(f), f))).toEqual([]);
    expect(frameFindings(read(FRAME_HOME), FRAME_HOME, true)).toEqual([`${FRAME_HOME} iframe`, `${FRAME_HOME} srcdoc`]);
    expect(frameFindings(read(REVIEW_HOME), REVIEW_HOME, true)).toEqual([`${REVIEW_HOME} iframe`, `${REVIEW_HOME} srcdoc`]);
  });

  it('rule 2 planted: an iframe or a srcdoc anywhere else is red', () => {
    expect(planted('src/lib/router.ts', "export const planted = () => document.createElement('iframe');", frameFindings))
      .toEqual(['src/lib/router.ts iframe']);
    expect(planted('src/screens/ReaderLab.tsx', 'export const Planted = () => <iframe srcDoc="x" />;', frameFindings))
      .toEqual(['src/screens/ReaderLab.tsx iframe', 'src/screens/ReaderLab.tsx srcdoc']);
  });

  it('rule 2 planted: the review page allowance is main.ts by exact path, so the same iframe in review/other.ts is red (M10, F10)', () => {
    const frame = "export const planted = (d: Document, t: string) => { const f = d.createElement('iframe'); f.srcdoc = t; return f; };";
    expect(frameFindings(frame, 'src/review/other.ts')).toEqual(['src/review/other.ts iframe', 'src/review/other.ts srcdoc']);
    expect(frameFindings(frame, 'src/review/main.tsx')).toEqual(['src/review/main.tsx iframe', 'src/review/main.tsx srcdoc']);
    expect(frameFindings(frame, REVIEW_HOME)).toEqual([]);
  });

  it('rule 2: the measurement fixture holds the nested iframe text, and the allowance is its exact path (R2.3)', () => {
    expect(frameFindings(read(LAB_FIXTURE_HOME), LAB_FIXTURE_HOME, true)).toEqual([`${LAB_FIXTURE_HOME} iframe`, `${LAB_FIXTURE_HOME} srcdoc`]);
    expect(frameFindings(read(LAB_FIXTURE_HOME), LAB_FIXTURE_HOME)).toEqual([]);
  });

  it('rule 2 planted: the same nested iframe text anywhere but labFixture.ts is red, review/other.ts and a sibling named like it included (R2.3)', () => {
    const nested = "export const LAB_PLANTED = '<iframe sandbox=\"\" srcdoc=\"&lt;p&gt;x&lt;/p&gt;\"></iframe>';";
    expect(frameFindings(nested, LAB_FIXTURE_HOME)).toEqual([]);
    for (const other of ['src/review/other.ts', 'src/review/labFixture.tsx', 'src/review/lab/labFixture.ts', 'src/readerLab/labFixture.ts']) {
      expect(frameFindings(nested, other), other).toEqual([`${other} iframe`, `${other} srcdoc`]);
    }
  });

  it('rule 3: no sandbox token beyond allow-scripts anywhere in pwa/src, and frames.ts sets sandbox only from LAB_SANDBOX (M10.9)', () => {
    expect(ALL().flatMap((f) => sandboxFindings(read(f), f))).toEqual([]);
    expect(read(FRAME_HOME)).toContain("el.setAttribute('sandbox', LAB_SANDBOX);");
    expect(read(REVIEW_HOME)).toContain("setAttribute('sandbox', '')");
  });

  it('rule 3 planted: a widened token or a sandbox set from anything else is red', () => {
    expect(planted('src/lib/router.ts', "export const planted = 'allow-scripts allow-same-origin';", sandboxFindings))
      .toEqual(['src/lib/router.ts token']);
    expect(planted(FRAME_HOME, "export const planted = (el: HTMLIFrameElement) => el.setAttribute('sandbox', 'allow-scripts');", sandboxFindings))
      .toEqual([`${FRAME_HOME} sandbox-value`]);
    expect(planted(FRAME_HOME, "export const planted2 = (el: HTMLIFrameElement) => { (el as unknown as { sandbox: string }).sandbox = 'x'; };", sandboxFindings))
      .toEqual([`${FRAME_HOME} sandbox-value`]);
  });

  it("rule 3 planted: the review page sets sandbox to the empty string only, in main.ts only (M5, M15)", () => {
    // The page's own call is the one allowed shape; the strictest sandbox widens nothing.
    expect(planted(REVIEW_HOME, "export const planted = (el: HTMLIFrameElement) => el.setAttribute('sandbox', '');", sandboxFindings)).toEqual([]);
    // Any other value in main.ts is red, the widened token and an assignment included.
    expect(planted(REVIEW_HOME, "export const planted = (el: HTMLIFrameElement) => el.setAttribute('sandbox', 'allow-scripts');", sandboxFindings))
      .toEqual([`${REVIEW_HOME} sandbox-value`]);
    expect(planted(REVIEW_HOME, "export const planted = (el: HTMLIFrameElement) => el.setAttribute('sandbox', LAB_SANDBOX);", sandboxFindings))
      .toEqual([`${REVIEW_HOME} sandbox-value`]);
    expect(planted(REVIEW_HOME, "export const planted = (el: HTMLIFrameElement) => { el.sandbox = ''; };", sandboxFindings))
      .toEqual([`${REVIEW_HOME} sandbox-value`]);
    // The empty string anywhere else in review/ is red: the allowance is the file, not the directory.
    expect(sandboxFindings("export const planted = (el: HTMLIFrameElement) => el.setAttribute('sandbox', '');", 'src/review/other.ts'))
      .toEqual(['src/review/other.ts sandbox-value']);
    // And the lab's own file does not gain the empty string.
    expect(planted(FRAME_HOME, "export const planted = (el: HTMLIFrameElement) => el.setAttribute('sandbox', '');", sandboxFindings))
      .toEqual([`${FRAME_HOME} sandbox-value`]);
  });

  it("rule 4: 'lab-draw' is spelled only in policy.ts and run.ts, and both spell it (M10.15)", () => {
    expect(ALL().flatMap((f) => labDrawFindings(read(f), f))).toEqual([]);
    for (const home of LAB_DRAW_HOMES) expect(read(home), home).toContain("'lab-draw'");
  });

  it("rule 4 planted: 'lab-draw' in the Docs reader's own frame is red", () => {
    expect(planted('src/docs/ReaderFrame.tsx', "export const PLANTED = 'lab-draw';", labDrawFindings)).toEqual(['src/docs/ReaderFrame.tsx lab-draw']);
  });
});
