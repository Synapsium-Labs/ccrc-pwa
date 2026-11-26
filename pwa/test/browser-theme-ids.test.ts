// NO BROWSER FILE HANDS THE APP A THEME THE APP DOES NOT KEEP (desktop polish wave 188).
//
// A browser case stores its theme where the app reads it (`openApp`, browser/app.ts) and the app resolves it with
// `resolveTheme` (@ccrc/ui). A value that is not a catalogue id resolves to SYSTEM, which is light in a browser context
// that sets no colour scheme. Seven files asked for 'dark', which is not an id (the dark palette is PHOSPHOR), so each
// "dark" case was its light case run a second time, and nothing went red. Those files never measured contrast in either
// theme; what went unmeasured was the dark palette's fit, sideways scroll and tap checks.
//
// The browser files run in no pull request's fast run, so this scan is the guard every pull request sees: it parses
// every file under pwa/browser with the repository's one parser (`server/test/scan/parse.ts`, D-8288) and holds each
// string literal that reaches the app as a theme to `resolveTheme(t) === t`. The ids come from @ccrc/ui, never from a
// second list here. What the scan cannot resolve
// (a value built at run time, imported from another module, or spread out of an argument array) is refused at run time
// by `openApp` itself, before any context opens.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ts } from '../../server/test/scan/parse';
import { PHOSPHOR, SYSTEM, THEMES, resolveTheme } from '@ccrc/ui';

const BROWSER = path.join(import.meta.dirname, '..', 'browser');

/** Named exceptions only: a file under pwa/browser and the GitHub issue that owns its fix, never a pattern. None today. */
const EXCEPTIONS: Readonly<Record<string, `#${number}`>> = {};

/** One string literal the scan found reaching the app as a theme. */
interface ThemeLiteral {
  readonly line: number;
  readonly text: string;
  /** Which shape carried it, so a red names how the value got there. */
  readonly shape: 'theme property' | 'themes list' | 'theme loop' | 'theme argument';
}

const THEME_NAME = /^theme$/i;
const LIST_NAME = /themes|palettes/i;

/** Strip what does not change a value: parentheses, `as`, `satisfies` and `!`. */
function unwrap(node: ts.Expression): ts.Expression {
  let n = node;
  for (;;) {
    if (ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isSatisfiesExpression(n) || ts.isNonNullExpression(n)) n = n.expression;
    else return n;
  }
}

const nameOf = (n: ts.Node | undefined): string | undefined =>
  n !== undefined && (ts.isIdentifier(n) || ts.isStringLiteral(n)) ? n.text : undefined;

/** Every theme literal in one browser file's source. */
function themeLiterals(fileName: string, source: string): ThemeLiteral[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found: ThemeLiteral[] = [];

  // Pass 1: the file's own string constants (`const DARK = 'dark'`) and its own functions' theme parameter positions.
  const constants = new Map<string, ts.StringLiteralLike>();
  const themeParam = new Map<string, number>();
  const visitDecls = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer !== undefined) {
      const init = unwrap(node.initializer);
      if (ts.isStringLiteralLike(init)) constants.set(node.name.text, init);
      if ((ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
        const at = init.parameters.findIndex((p) => THEME_NAME.test(nameOf(p.name) ?? ''));
        if (at >= 0) themeParam.set(node.name.text, at);
      }
    }
    if (ts.isFunctionDeclaration(node) && node.name !== undefined) {
      const at = node.parameters.findIndex((p) => THEME_NAME.test(nameOf(p.name) ?? ''));
      if (at >= 0) themeParam.set(node.name.text, at);
    }
    ts.forEachChild(node, visitDecls);
  };
  visitDecls(sf);

  const take = (expr: ts.Expression, shape: ThemeLiteral['shape']): void => {
    const e = unwrap(expr);
    if (ts.isConditionalExpression(e)) {
      take(e.whenTrue, shape);
      take(e.whenFalse, shape);
      return;
    }
    const lit = ts.isStringLiteralLike(e) ? e : ts.isIdentifier(e) ? constants.get(e.text) : undefined;
    if (lit === undefined) return;
    found.push({ line: sf.getLineAndCharacterOfPosition(lit.getStart(sf)).line + 1, text: lit.text, shape });
  };
  const takeList = (expr: ts.Expression, shape: ThemeLiteral['shape']): void => {
    const e = unwrap(expr);
    if (ts.isArrayLiteralExpression(e)) for (const el of e.elements) if (!ts.isSpreadElement(el)) take(el, shape);
  };

  // Pass 2: the four shapes.
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAssignment(node)) {
      const key = nameOf(node.name) ?? '';
      if (THEME_NAME.test(key)) take(node.initializer, 'theme property');
      else if (LIST_NAME.test(key)) takeList(node.initializer, 'themes list');
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && LIST_NAME.test(node.name.text) && node.initializer !== undefined) {
      takeList(node.initializer, 'themes list');
    }
    if (ts.isForOfStatement(node) && ts.isVariableDeclarationList(node.initializer)) {
      const decl = node.initializer.declarations[0];
      if (decl !== undefined && THEME_NAME.test(nameOf(decl.name) ?? '')) takeList(node.expression, 'theme loop');
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const at = themeParam.get(node.expression.text);
      const arg = at === undefined ? undefined : node.arguments[at];
      if (arg !== undefined && !ts.isSpreadElement(arg)) take(arg, 'theme argument');
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

const kept = (t: string): boolean => resolveTheme(t) === t;

describe('the scan finds every shape a theme reaches the app by', () => {
  const texts = (src: string) => themeLiterals('x.browser.test.ts', src).map((l) => `${l.shape}:${l.text}`);

  it('a theme property, directly, through a conditional, a file constant or a spread object', () => {
    expect(texts("openApp(b, { skin, theme: 'dark', width }, F);")).toEqual(['theme property:dark']);
    expect(texts("openApp(b, { theme: wide ? 'light' : 'dusk' }, F);")).toEqual(['theme property:light', 'theme property:dusk']);
    expect(texts("const DARK = 'dark';\nopenApp(b, { skin, theme: DARK, width }, F);")).toEqual(['theme property:dark']);
    expect(texts("openApp(b, { ...{ skin, width }, ...{ theme: 'dark' } }, F);")).toEqual(['theme property:dark']);
  });

  it('a themes list, bound to a name or a property, and a theme loop over a literal list', () => {
    expect(texts("const THEMES = ['light', 'dark'] as const;")).toEqual(['themes list:light', 'themes list:dark']);
    expect(texts("const M = { widths: [360], themes: ['light', 'dark'] } as const;")).toEqual(['themes list:light', 'themes list:dark']);
    expect(texts("const PALETTES = [PHOSPHOR, 'dusk'];")).toEqual(['themes list:dusk']);
    expect(texts("for (const theme of ['light', 'dark']) {}")).toEqual(['theme loop:light', 'theme loop:dark']);
  });

  it("a bare string argument in a theme parameter's place, for a function declared or bound in the file", () => {
    expect(texts("async function openSheet(width: number, skin: string, theme: string) {}\nopenSheet(360, skin, 'dark');"))
      .toEqual(['theme argument:dark']);
    expect(texts("const open = async (skin: string, theme: string) => {};\nopen(REFINED, 'dark');")).toEqual(['theme argument:dark']);
  });

  it('what it cannot resolve, it leaves to the opener: a spread argument list, a value from elsewhere', () => {
    expect(texts("async function open(skin: string, theme: string) {}\nopen(...['r', 'dark']);")).toEqual([]);
    expect(texts("import { DUSK } from './elsewhere';\nopenApp(b, { theme: DUSK }, F);")).toEqual([]);
  });

  it('an identifier from the catalogue is not a literal at all', () => {
    expect(texts('const THEMES = [PHOSPHOR, SYSTEM];')).toEqual([]);
  });
});

describe('no browser file hands the app a theme the app does not keep', () => {
  const files = readdirSync(BROWSER).filter((f) => /\.tsx?$/.test(f)).sort();
  const scanned = files.map((file) => ({ file, literals: themeLiterals(file, readFileSync(path.join(BROWSER, file), 'utf8')) }));

  it('reads the catalogue it judges by from @ccrc/ui', () => {
    expect(kept(PHOSPHOR) && kept('light') && kept(SYSTEM)).toBe(true);
    expect(THEMES.length).toBeGreaterThan(2);
    expect(kept('dark'), "'dark' is not an id").toBe(false);
  });

  it('finds theme literals at all (a scan that finds nothing proves nothing)', () => {
    const literals = scanned.flatMap((s) => s.literals);
    const withAny = scanned.filter((s) => s.literals.length > 0);
    expect(literals.length, 'theme literals found').toBeGreaterThanOrEqual(120);
    expect(withAny.length, 'browser files with a theme literal').toBeGreaterThanOrEqual(80);
  });

  it('every theme literal is a catalogue id or SYSTEM', () => {
    const bad = scanned.flatMap(({ file, literals }) => literals
      .filter((l) => !kept(l.text))
      .map((l) => `${file}:${l.line} ${l.shape} '${l.text}' (the app would draw ${resolveTheme(l.text)})`));
    const unexcused = bad.filter((b) => !(b.split(':')[0]! in EXCEPTIONS));
    expect(unexcused).toEqual([]);
  });

  it('every named exception is a browser file that still needs one', () => {
    for (const file of Object.keys(EXCEPTIONS)) {
      const entry = scanned.find((s) => s.file === file);
      expect(entry, `${file} exists`).toBeDefined();
      expect(entry!.literals.some((l) => !kept(l.text)), `${file} still hands the app an unkept theme`).toBe(true);
    }
  });
});
