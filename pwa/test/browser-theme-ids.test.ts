// NO BROWSER FILE HANDS THE APP A THEME THE APP DOES NOT KEEP (desktop polish wave 188).
//
// A browser case stores its theme where the app reads it (`openApp`, browser/app.ts) and the app resolves it with
// `resolveTheme` (@ccrc/ui). A value that is not a catalogue id resolves to SYSTEM, which is light in a browser context
// that sets no colour scheme. Seven files asked for 'dark', which is not an id (the dark palette is PHOSPHOR), so each
// "dark" case was its light case run a second time, and nothing went red. Those files never measured contrast in either
// theme; what went unmeasured was the dark palette's fit, sideways scroll and tap checks.
//
// The browser files run in no pull request's fast run, so this scan is the guard every pull request sees. It parses every
// file under pwa/browser, subdirectories included, with the repository's one parser (`server/test/scan/parse.ts`,
// D-8288), and holds each string literal it reads reaching the app as a theme to `resolveTheme(t) === t`. The ids come
// from @ccrc/ui, never from a second list here. What it reads is this closed list of seven shapes (`SHAPES`):
//   - theme property: `{ theme: 'x' }`, a spread object or a conditional included, and `{ theme }` or `{ theme: X }`
//     where the name is a `const` holding a literal, declared once in the file;
//   - themes list: a list bound to a name or a property matching /themes|palettes/i;
//   - theme loop and tuple loop: `for (const theme of [...])`, and `for (const [theme, width] of [[...], ...])` (the cell
//     in theme's position of each row);
//   - theme argument: a literal in the place of a `theme` parameter of a function declared or bound in the same file;
//   - mapped list: a literal list whose method's callback binds `theme` (or a tuple holding it) as its first parameter,
//     `[PHOSPHOR, 'light'].flatMap((theme) => …)`;
//   - each table: `it.each(table)(title, (…, theme, …) => …)`, the cell in theme's parameter position of each row.
//
// Anything else is unread, and is the opener's to refuse: `openApp` refuses a theme the app does not keep at run time,
// before any context opens (pinned in browser-dist.test.ts), but that runs only in the merge queue's browser leg, never in
// a pull request's fast run. A static scan cannot list everything it does not read; examples, each pinned as reading
// nothing below: concatenation and templates with a substitution; a value or a list imported from another module; a call
// or a member read; the default value of a `theme` parameter (live in phone-bar's file, whose `open` defaults theme to
// 'light' and three of its calls leave the argument out); the right side of a `??` or `||` fallback; a `let` or a `var`,
// reassigned or not; a name declared more than once in the file, whatever its scopes; a tagged-template each table; a
// method call (`h.open(skin, 'x')`); a callback that binds `theme` as a later parameter; a list that is not a literal; a
// spread argument list; and a callback whose parameter has another name.
import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
  readonly shape: Shape;
}

/** Every shape the scan reads: the closed list the header names. */
const SHAPES = ['theme property', 'themes list', 'theme loop', 'tuple loop', 'theme argument', 'mapped list', 'each table'] as const;
type Shape = typeof SHAPES[number];

/** Each shape's floor in the real tree: at least one literal, so a shape the visitor stops reading is red whatever the
 *  total is. A shape that leaves the tree on purpose lowers its own floor here in the same commit, with the reason. */
const SHAPE_FLOORS: Readonly<Record<Shape, number>> = {
  'theme property': 1, 'themes list': 1, 'theme loop': 1, 'tuple loop': 1, 'theme argument': 1, 'mapped list': 1, 'each table': 1,
};

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

  // Pass 1: the file's own string constants (`const DARK = 'dark'`), its own functions' theme parameter positions, and how
  // often each name is declared. A `let` or a `var` is never a constant (a binding judged by its first value would give
  // false reds and false passes both), and nor is a name declared more than once: constants are one map by name with no
  // scopes, so two same-named bindings would judge one against the other's value.
  const constants = new Map<string, ts.StringLiteralLike>();
  const themeParam = new Map<string, number>();
  const declared = new Map<string, number>();
  const declare = (name: ts.BindingName | undefined): void => {
    if (name === undefined) return;
    if (ts.isIdentifier(name)) declared.set(name.text, (declared.get(name.text) ?? 0) + 1);
    else for (const el of name.elements) if (ts.isBindingElement(el)) declare(el.name);
  };
  const visitDecls = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) || ts.isParameter(node)) declare(node.name);
    if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name !== undefined) declare(node.name);
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer !== undefined) {
      const init = unwrap(node.initializer);
      const isConst = ts.isVariableDeclarationList(node.parent) && (node.parent.flags & ts.NodeFlags.Const) !== 0;
      if (isConst && ts.isStringLiteralLike(init)) constants.set(node.name.text, init);
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

  const take = (expr: ts.Expression, shape: Shape): void => {
    const e = unwrap(expr);
    if (ts.isConditionalExpression(e)) {
      take(e.whenTrue, shape);
      take(e.whenFalse, shape);
      return;
    }
    const lit = ts.isStringLiteralLike(e) ? e
      : ts.isIdentifier(e) && declared.get(e.text) === 1 ? constants.get(e.text) : undefined;
    if (lit === undefined) return;
    found.push({ line: sf.getLineAndCharacterOfPosition(lit.getStart(sf)).line + 1, text: lit.text, shape });
  };
  const takeList = (expr: ts.Expression, shape: Shape): void => {
    const e = unwrap(expr);
    if (ts.isArrayLiteralExpression(e)) for (const el of e.elements) if (!ts.isSpreadElement(el)) take(el, shape);
  };

  /** A binding laid over each element of a literal list: `theme` itself takes every element; `[…, theme, …]` takes the
   *  element in theme's position of each tuple row (a row that is not a literal tuple is skipped). */
  const takeBound = (name: ts.BindingName, list: ts.Expression, whole: Shape, tuple: Shape): void => {
    const rows = unwrap(list);
    if (!ts.isArrayLiteralExpression(rows)) return;
    if (ts.isIdentifier(name)) {
      if (THEME_NAME.test(name.text)) takeList(rows, whole);
      return;
    }
    if (!ts.isArrayBindingPattern(name)) return;
    const at = name.elements.findIndex((el) => ts.isBindingElement(el) && THEME_NAME.test(nameOf(el.name) ?? ''));
    if (at < 0) return;
    for (const row of rows.elements) {
      const r = ts.isSpreadElement(row) ? undefined : unwrap(row);
      const cell = r !== undefined && ts.isArrayLiteralExpression(r) ? r.elements[at] : undefined;
      if (cell !== undefined && !ts.isSpreadElement(cell)) take(cell, tuple);
    }
  };
  const callbackOf = (args: readonly ts.Expression[]): ts.SignatureDeclarationBase | undefined =>
    args.map(unwrap).find((a): a is ts.ArrowFunction | ts.FunctionExpression => ts.isArrowFunction(a) || ts.isFunctionExpression(a));

  // Pass 2: the shapes.
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAssignment(node)) {
      const key = nameOf(node.name) ?? '';
      if (THEME_NAME.test(key)) take(node.initializer, 'theme property');
      else if (LIST_NAME.test(key)) takeList(node.initializer, 'themes list');
    }
    // `{ skin, theme, width }`: judged when `theme` is a `const` holding a literal, declared once in the file.
    if (ts.isShorthandPropertyAssignment(node) && THEME_NAME.test(node.name.text)) take(node.name, 'theme property');
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && LIST_NAME.test(node.name.text) && node.initializer !== undefined) {
      takeList(node.initializer, 'themes list');
    }
    if (ts.isForOfStatement(node) && ts.isVariableDeclarationList(node.initializer)) {
      const decl = node.initializer.declarations[0];
      if (decl !== undefined) takeBound(decl.name, node.expression, 'theme loop', 'tuple loop');
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const at = themeParam.get(node.expression.text);
      const arg = at === undefined ? undefined : node.arguments[at];
      if (arg !== undefined && !ts.isSpreadElement(arg)) take(arg, 'theme argument');
    }
    // `[PHOSPHOR, 'light'].flatMap((theme) => …)`, and `.map`, `.forEach` and the rest: a literal list whose method's
    // callback binds `theme` (or a tuple holding it) as its first parameter.
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && ts.isArrayLiteralExpression(unwrap(node.expression.expression))) {
      const first = callbackOf(node.arguments)?.parameters[0];
      if (first !== undefined) takeBound(first.name, node.expression.expression, 'mapped list', 'mapped list');
    }
    // `it.each(table)(title, (theme, …) => …)`: each row's cell in theme's parameter position; a row that is not a tuple is
    // the first parameter's value.
    if (ts.isCallExpression(node) && ts.isCallExpression(node.expression) && ts.isPropertyAccessExpression(node.expression.expression)
      && node.expression.expression.name.text === 'each' && node.expression.arguments[0] !== undefined) {
      const params = callbackOf(node.arguments)?.parameters ?? [];
      const at = params.findIndex((p) => THEME_NAME.test(nameOf(p.name) ?? ''));
      const rows = unwrap(node.expression.arguments[0]);
      if (at >= 0 && ts.isArrayLiteralExpression(rows)) {
        for (const row of rows.elements) {
          if (ts.isSpreadElement(row)) continue;
          const r = unwrap(row);
          if (ts.isArrayLiteralExpression(r)) {
            const cell = r.elements[at];
            if (cell !== undefined && !ts.isSpreadElement(cell)) take(cell, 'each table');
          } else if (at === 0) take(r, 'each table');
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

const kept = (t: string): boolean => resolveTheme(t) === t;

describe('the scan reads its seven shapes (SHAPES), a closed list; anything else is the opener\'s', () => {
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

  it('a shorthand theme property whose name is a constant of the file holding a literal', () => {
    expect(texts("const theme = 'dark';\nopenApp(b, { skin, theme, width }, F);")).toEqual(['theme property:dark']);
    expect(texts("function f(theme: string) { return openApp(b, { skin, theme, width }, F); }")).toEqual([]);
  });

  it("a tuple loop: the cell in theme's position of each literal row", () => {
    expect(texts("for (const [theme, width] of [[PHOSPHOR, 360], ['dark', 390]] as const) {}")).toEqual(['tuple loop:dark']);
    expect(texts("for (const [skin, theme] of [[REFINED, 'light'], [INSTRUMENT, 'dusk']]) {}")).toEqual(['tuple loop:light', 'tuple loop:dusk']);
    expect(texts("for (const [skin, width] of [['dark', 360]]) {}")).toEqual([]);
  });

  it('a mapped list: a literal list whose callback binds theme first, nested or not, as a name or in a tuple', () => {
    expect(texts("const V = [REFINED, INSTRUMENT].flatMap((skin) => [PHOSPHOR, 'dark'].flatMap((theme) => [{ skin, theme }]));"))
      .toEqual(['mapped list:dark']);
    expect(texts("[PHOSPHOR, 'dark'].map((theme): View => ({ theme }));")).toEqual(['mapped list:dark']);
    expect(texts("[[PHOSPHOR, 360], ['dark', 390]].forEach(([theme, width]) => {});")).toEqual(['mapped list:dark']);
    expect(texts("[360, 390].map((width) => width);")).toEqual([]);
  });

  it("an each table: the cell in theme's parameter position, or the row itself for a first parameter", () => {
    expect(texts("it.each([['light', 'dark'], ['dusk', 'light']] as const)('%s', async (theme, stale) => {});"))
      .toEqual(['each table:light', 'each table:dusk']);
    expect(texts("it.each(['light', 'dark'])('%s', async (theme) => {});")).toEqual(['each table:light', 'each table:dark']);
    expect(texts("it.each(['light', 'dark'])('%s', async (device) => {});")).toEqual([]);
  });

  it('a name declared more than once in the file is not resolved; a name declared once is, before or after its use', () => {
    // Two functions, each with its own `const theme`: judging both by one map passed the 'dark' one silently.
    expect(texts("function a() { const theme = 'dark'; return openApp(b, { skin, theme }, F); }\n"
      + "function c() { const theme = 'light'; return openApp(b, { skin, theme }, F); }")).toEqual([]);
    // An outer constant shadowed by an inner one, and a file constant beside a parameter of the same name: both went red
    // on a value the app never received.
    expect(texts("const SHADE = 'dark';\nfunction f() { const SHADE = PHOSPHOR; return openApp(b, { theme: SHADE }, F); }")).toEqual([]);
    expect(texts("const theme = 'oops';\nfunction f(theme: string) { return openApp(b, { skin, theme }, F); }")).toEqual([]);
    expect(texts("openApp(b, { theme: LATE }, F);\nconst LATE = 'dark';")).toEqual(['theme property:dark']);
  });

  it('examples of what it does not read (not a complete list): each is the opener\'s to refuse', () => {
    expect(texts("openApp(b, { theme: 'da' + 'rk' }, F);")).toEqual([]);
    expect(texts("openApp(b, { theme: `${'da'}rk` }, F);")).toEqual([]);
    expect(texts("import { DUSK } from './elsewhere';\nopenApp(b, { theme: DUSK }, F);")).toEqual([]);
    expect(texts("import { MODES } from '../test/modes';\nfor (const theme of MODES) {}")).toEqual([]);
    expect(texts("openApp(b, { theme: pick() }, F);\nopenApp(b, { theme: M.dark }, F);")).toEqual([]);
    expect(texts("async function openIt(skin: string, theme = 'dark') { return openApp(b, { skin, theme }, F); }\nopenIt(REFINED);"))
      .toEqual([]);
    expect(texts("openApp(b, { theme: pick ?? 'dark' }, F);\nopenApp(b, { theme: (pick as string) || 'dark' }, F);")).toEqual([]);
    expect(texts("let DUSK = 'dark';\nopenApp(b, { theme: DUSK }, F);")).toEqual([]);
    expect(texts("var DUSK = 'dark';\nopenApp(b, { theme: DUSK }, F);")).toEqual([]);
    expect(texts("let theme = 'light';\ntheme = 'dark';\nopenApp(b, { theme }, F);")).toEqual([]);
    expect(texts("it.each`theme\n${'dark'}`('%s', async ({ theme }) => {});")).toEqual([]);
    expect(texts("const h = { open: (skin: string, theme: string) => {} };\nh.open(REFINED, 'dark');")).toEqual([]);
    expect(texts("['dark'].reduce((acc, theme) => acc, '');")).toEqual([]);
    expect(texts("const MODES = ['dark'];\nMODES.map((theme) => ({ theme }));")).toEqual([]);
    expect(texts("async function open(skin: string, theme: string) {}\nopen(...['r', 'dark']);")).toEqual([]);
    expect(texts("['dark'].map((t) => ({ theme: t }));")).toEqual([]);
  });

  it('an identifier from the catalogue is not a literal at all', () => {
    expect(texts('const THEMES = [PHOSPHOR, SYSTEM];')).toEqual([]);
  });
});

/** Every TypeScript source under `dir`, as a path relative to it, the way the browser leg collects its files
 *  (`browser/**`, vitest.browser.config.ts): subdirectories included. */
function browserSources(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((f) => /\.tsx?$/.test(f)).sort();
}

describe('the scan lists the browser directory as the browser leg collects it', () => {
  it('reads a source in a subdirectory too', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'browser-theme-ids-'));
    try {
      mkdirSync(path.join(dir, 'nested'));
      writeFileSync(path.join(dir, 'a.browser.test.ts'), '');
      writeFileSync(path.join(dir, 'nested', 'b.browser.test.tsx'), '');
      writeFileSync(path.join(dir, 'nested', 'notes.md'), '');
      expect(browserSources(dir)).toEqual(['a.browser.test.ts', path.join('nested', 'b.browser.test.tsx')]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/** The totals' floors (the floor case below says how they are set). */
const TOTAL_FLOOR = 120;
const FILES_FLOOR = 80;

describe('no browser file hands the app a theme the app does not keep', () => {
  const files = browserSources(BROWSER);
  const scanned = files.map((file) => ({ file, literals: themeLiterals(file, readFileSync(path.join(BROWSER, file), 'utf8')) }));

  it('reads the catalogue it judges by from @ccrc/ui', () => {
    expect(kept(PHOSPHOR) && kept('light') && kept(SYSTEM)).toBe(true);
    expect(THEMES.length).toBeGreaterThan(2);
    expect(kept('dark'), "'dark' is not an id").toBe(false);
  });

  // Measured on this wave's head merged with main a45831a795 (the note, section 4): 152 literals in 105 of 143 files. The
  // totals' floors are about four fifths of that, rounded down to ten; each shape's floor is in SHAPE_FLOORS.
  it('finds theme literals at all, in every shape it reads (a scan that finds nothing proves nothing)', () => {
    const literals = scanned.flatMap((s) => s.literals);
    const withAny = scanned.filter((s) => s.literals.length > 0);
    for (const shape of SHAPES) {
      expect(literals.filter((l) => l.shape === shape).length, `${shape} literals found (if this shape left the tree on `
        + 'purpose, lower its floor in SHAPE_FLOORS in the same commit, with the reason)').toBeGreaterThanOrEqual(SHAPE_FLOORS[shape]);
    }
    expect(literals.length, 'theme literals found').toBeGreaterThanOrEqual(TOTAL_FLOOR);
    expect(withAny.length, 'browser files with a theme literal').toBeGreaterThanOrEqual(FILES_FLOOR);
  });

  it('every theme literal is a catalogue id or SYSTEM', () => {
    const bad = scanned.flatMap(({ file, literals }) => literals
      .filter((l) => !kept(l.text))
      .map((l) => `${file}:${l.line} ${l.shape} '${l.text}' (the app would draw ${resolveTheme(l.text)})`
        + (l.shape === 'mapped list' ? "; if that list is not themes, rename the callback's parameter, or take the named-file "
          + 'exception route (EXCEPTIONS, with its issue)' : '')));
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
