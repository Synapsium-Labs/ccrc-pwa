/**
 * D-5853 (plan docs/superpowers/plans/2026-10-19-consolidation-w0-pins.md, Task C0f; ARCH-00 (#525); spec
 * 2026-10-19-ccrc-consolidation-wave-design.md §8, rev 2.2). The ONE TypeScript parser the server's test scanners use.
 *
 * The server builds with TypeScript 7, whose package exports no `createSourceFile` (only `typescript/unstable/*`). The
 * operator chose (2026-10-20, OA-C1, option (a)) the stable, documented TypeScript 6 compiler API, installed as the
 * dev-only alias `typescript-api` and pinned EXACTLY in `server/package.json`: the server's TypeScript bumps
 * cannot change what a scanner sees, and a new parser version needs a reviewed PR. Tests only: nothing under
 * `server/src` imports it, and this file is its one importer (`single-definition.test.ts`, the ARCH-40 describe). A
 * later swap of the parser touches this file alone.
 *
 * Syntax only, no type checker: import-edge and symbol rules do not need one.
 * D-5854 (Task C0g; ARCH-06 (#554)) adds `calls` and `bindings`, which `scan/symbols.ts` (`callsIn`) and the literal
 * source-pin ratchet (`single-definition.test.ts`, the ARCH-40 describe) read, so neither imports the parser.
 * KNOWN WIDTH: a file that does not parse yields what the parser recovered (no throw); a computed member name, an
 * object-literal method and a function bound through `as`, a call or parentheses are not symbols; an alias exported
 * by a later `export { X }` is not an exported type alias; `require(…)` calls are not import edges.
 */
import { readFileSync } from 'node:fs';
import ts from 'typescript-api';

/** One module edge: an `import`, an `export … from`, an `import x = require(…)` or a literal `import(…)`. */
export interface ImportEdge {
  specifier: string;
  kind: 'import' | 'export-from' | 'import-equals' | 'dynamic';
  /** `import type …`, `export type … from`, `import type x = require(…)`. A per-name `type` leaves this false. */
  typeOnly: boolean;
  /** The bound names: `default` as its local name, a namespace as `* as x`, named ones by their imported name. */
  names: string[];
  /** 1-based. */
  line: number;
}

/** An exported top-level `type X = …`. `literals` holds a literal union's members (string, number or boolean, as
 *  text), and is `null` for any other type. */
export interface TypeAlias {
  name: string;
  literals: string[] | null;
  line: number;
}

export type SymbolKind = 'function' | 'class' | 'method' | 'constructor' | 'getter' | 'setter' | 'arrow-property'
  | 'variable-function';

/** A named code unit, keyed by its qualified name (`Class.method`, `outer.inner`). `start`/`end` are offsets into the
 *  text, from its first token to its last; `line`/`endLine` are 1-based. */
export interface SymbolSpan {
  name: string;
  kind: SymbolKind;
  start: number;
  end: number;
  line: number;
  endLine: number;
}

/** One argument of a call: a string (a plain or no-substitution template literal, by its value), a regex literal (by
 *  its source text, slashes and flags included), or anything else (by its source text). */
export interface CallArg {
  kind: 'string' | 'regex' | 'other';
  text: string;
}

/** A call expression (`f(…)`, `a.b(…)`, `expect(x).not.toContain(…)`; not `new`, not `import(…)`), in source order.
 *  `callee` is the callee's text with each line break and its indentation removed; `name` its rightmost identifier
 *  (`null` for an element access or a call of a call); `head` the leftmost identifier of its chain (`src` for
 *  `src.slice(1).indexOf`, `expect` for `expect(a).not.toContain`); `headArgs` the argument texts when that head is
 *  itself called (`expect(a, 'm')` → `['a', "'m'"]`), else `null`. `boundTo` is the `const|let|var` the call
 *  initialises, through any wrapping expression but never through a function, block or statement. */
export interface CallSite {
  callee: string;
  name: string | null;
  head: string | null;
  headArgs: string[] | null;
  args: CallArg[];
  boundTo: string | null;
  start: number;
  end: number;
  line: number;
}

/** A `const|let|var` with a plain identifier name and an initialiser (`init` its source text, starting at offset
 *  `initStart`), in source order. `scopeStart`/`scopeEnd` span the block, loop, function or file it is declared in, so
 *  a name used at an offset resolves to the innermost binding whose scope holds it. */
export interface Binding {
  name: string;
  init: string;
  initStart: number;
  start: number;
  end: number;
  line: number;
  scopeStart: number;
  scopeEnd: number;
}

export interface ParsedFile {
  path: string;
  text: string;
  imports: ImportEdge[];
  exportedTypeAliases: TypeAlias[];
  symbols: SymbolSpan[];
  calls: CallSite[];
  bindings: Binding[];
}

const scriptKindOf = (file: string): ts.ScriptKind =>
  /\.tsx$/.test(file) ? ts.ScriptKind.TSX
    : /\.jsx$/.test(file) ? ts.ScriptKind.JSX
      : /\.[cm]?js$/.test(file) ? ts.ScriptKind.JS
        : ts.ScriptKind.TS;

/** A member or declaration name the scanners can key on; `null` for a computed one. */
const nameText = (n: ts.PropertyName | ts.BindingName | undefined): string | null =>
  n && (ts.isIdentifier(n) || ts.isPrivateIdentifier(n) || ts.isStringLiteral(n) || ts.isNumericLiteral(n))
    ? n.text : null;

const isFunctionValue = (e: ts.Expression | undefined): e is ts.ArrowFunction | ts.FunctionExpression =>
  !!e && (ts.isArrowFunction(e) || ts.isFunctionExpression(e));

const isExported = (n: ts.Node): boolean =>
  ts.canHaveModifiers(n) && (ts.getModifiers(n) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

const literalText = (t: ts.TypeNode): string | null => {
  if (!ts.isLiteralTypeNode(t)) return null;
  const l = t.literal;
  if (ts.isStringLiteral(l) || ts.isNumericLiteral(l)) return l.text;
  if (l.kind === ts.SyntaxKind.TrueKeyword) return 'true';
  if (l.kind === ts.SyntaxKind.FalseKeyword) return 'false';
  return null;
};

const unionLiterals = (t: ts.TypeNode): string[] | null => {
  const members = ts.isUnionTypeNode(t) ? [...t.types] : [t];
  const out = members.map(literalText);
  return out.every((x): x is string => x !== null) ? out : null;
};

/** Parse TypeScript (or JS/TSX, by `fileName`'s extension) text. Syntax only. */
export function parseSource(text: string, fileName = 'source.ts'): ParsedFile {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, scriptKindOf(fileName));
  const lineOf = (pos: number): number => sf.getLineAndCharacterOfPosition(pos).line + 1;
  const imports: ImportEdge[] = [];
  const exportedTypeAliases: TypeAlias[] = [];
  const symbols: SymbolSpan[] = [];
  const calls: CallSite[] = [];
  const bindings: Binding[] = [];
  const flat = (n: ts.Node): string => n.getText(sf).replace(/\r?\n[ \t]*/g, '');

  const addCall = (node: ts.CallExpression): void => {
    const callee = node.expression;
    const name = ts.isIdentifier(callee) ? callee.text
      : ts.isPropertyAccessExpression(callee) ? callee.name.text : null;
    let h: ts.Expression = callee;
    let headArgs: string[] | null = null;
    for (;;) {
      if (ts.isPropertyAccessExpression(h) || ts.isElementAccessExpression(h) || ts.isNonNullExpression(h)
        || ts.isParenthesizedExpression(h)) { h = h.expression; continue; }
      if (ts.isCallExpression(h)) {
        if (ts.isIdentifier(h.expression)) headArgs = h.arguments.map(flat);
        h = h.expression; continue;
      }
      break;
    }
    const head = ts.isIdentifier(h) ? h.text : h.kind === ts.SyntaxKind.ThisKeyword ? 'this' : null;
    if (head === null) headArgs = null;
    let boundTo: string | null = null;
    for (let p: ts.Node = node.parent; ; p = p.parent) {
      if (ts.isVariableDeclaration(p)) { boundTo = nameText(p.name); break; }
      if (ts.isFunctionLike(p) || ts.isBlock(p) || ts.isSourceFile(p) || ts.isExpressionStatement(p)
        || ts.isReturnStatement(p) || ts.isClassLike(p) || ts.isPropertyDeclaration(p)) break;
    }
    const args: CallArg[] = node.arguments.map((a) => ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a)
      ? { kind: 'string' as const, text: a.text }
      : ts.isRegularExpressionLiteral(a) ? { kind: 'regex' as const, text: a.text } : { kind: 'other' as const, text: flat(a) });
    const start = node.getStart(sf);
    calls.push({ callee: flat(callee), name, head, headArgs, args, boundTo, start, end: node.end, line: lineOf(start) });
  };

  const addSymbol = (name: string, kind: SymbolKind, node: ts.Node): void => {
    const start = node.getStart(sf);
    symbols.push({ name, kind, start, end: node.end, line: lineOf(start), endLine: lineOf(node.end) });
  };

  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier)) {
      const c = st.importClause;
      const names: string[] = [];
      if (c?.name) names.push(c.name.text);
      const nb = c?.namedBindings;
      if (nb && ts.isNamespaceImport(nb)) names.push(`* as ${nb.name.text}`);
      if (nb && ts.isNamedImports(nb)) for (const e of nb.elements) names.push((e.propertyName ?? e.name).text);
      imports.push({ specifier: st.moduleSpecifier.text, kind: 'import',
        typeOnly: c?.phaseModifier === ts.SyntaxKind.TypeKeyword, names, line: lineOf(st.getStart(sf)) });
    } else if (ts.isExportDeclaration(st) && st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier)) {
      const ec = st.exportClause;
      const names = !ec ? ['*']
        : ts.isNamespaceExport(ec) ? [`* as ${nameText(ec.name) ?? ''}`]
          : ec.elements.map((e) => nameText(e.propertyName ?? e.name) ?? '');
      imports.push({ specifier: st.moduleSpecifier.text, kind: 'export-from', typeOnly: st.isTypeOnly, names,
        line: lineOf(st.getStart(sf)) });
    } else if (ts.isImportEqualsDeclaration(st) && ts.isExternalModuleReference(st.moduleReference)
      && ts.isStringLiteral(st.moduleReference.expression)) {
      imports.push({ specifier: st.moduleReference.expression.text, kind: 'import-equals', typeOnly: st.isTypeOnly,
        names: [st.name.text], line: lineOf(st.getStart(sf)) });
    } else if (ts.isTypeAliasDeclaration(st) && isExported(st)) {
      exportedTypeAliases.push({ name: st.name.text, literals: unionLiterals(st.type), line: lineOf(st.getStart(sf)) });
    }
  }

  const visit = (node: ts.Node, scope: readonly string[]): void => {
    const q = (n: string): string => [...scope, n].join('.');
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const a = node.arguments[0];
      if (a && ts.isStringLiteralLike(a)) {
        imports.push({ specifier: a.text, kind: 'dynamic', typeOnly: false, names: [], line: lineOf(node.getStart(sf)) });
      }
    } else if (ts.isCallExpression(node)) addCall(node);
    if (ts.isVariableDeclaration(node) && node.initializer && ts.isIdentifier(node.name)) {
      const start = node.getStart(sf);
      let sc: ts.Node = node.parent;
      while (!(ts.isBlock(sc) || ts.isSourceFile(sc) || ts.isModuleBlock(sc) || ts.isCaseBlock(sc) || ts.isForStatement(sc)
        || ts.isForOfStatement(sc) || ts.isForInStatement(sc) || ts.isFunctionLike(sc))) sc = sc.parent;
      bindings.push({ name: node.name.text, init: node.initializer.getText(sf), initStart: node.initializer.getStart(sf),
        start, end: node.end, line: lineOf(start), scopeStart: sc.getStart(sf), scopeEnd: sc.end });
    }
    if (ts.isFunctionDeclaration(node) && node.name) {
      addSymbol(q(node.name.text), 'function', node);
      ts.forEachChild(node, (c) => visit(c, [...scope, node.name!.text]));
      return;
    }
    if ((ts.isClassDeclaration(node) || ts.isClassExpression(node)) && node.name) {
      const cls = node.name.text;
      addSymbol(q(cls), 'class', node);
      for (const m of node.members) {
        const own = [...scope, cls];
        const at = (n: string): string => [...own, n].join('.');
        if (ts.isConstructorDeclaration(m)) {
          addSymbol(at('constructor'), 'constructor', m);
          ts.forEachChild(m, (c) => visit(c, [...own, 'constructor']));
          continue;
        }
        const mn = nameText(m.name);
        if (mn === null) { ts.forEachChild(m, (c) => visit(c, own)); continue; }
        if (ts.isMethodDeclaration(m)) addSymbol(at(mn), 'method', m);
        else if (ts.isGetAccessorDeclaration(m)) addSymbol(at(mn), 'getter', m);
        else if (ts.isSetAccessorDeclaration(m)) addSymbol(at(mn), 'setter', m);
        else if (ts.isPropertyDeclaration(m) && isFunctionValue(m.initializer)) addSymbol(at(mn), 'arrow-property', m);
        else { ts.forEachChild(m, (c) => visit(c, own)); continue; }
        ts.forEachChild(m, (c) => visit(c, [...own, mn]));
      }
      return;
    }
    if (ts.isVariableDeclaration(node) && isFunctionValue(node.initializer)) {
      const vn = nameText(node.name);
      if (vn !== null) {
        // The span is the whole statement for a single declaration, so it starts at its `export`/`const`.
        const list = node.parent;
        const whole = ts.isVariableDeclarationList(list) && list.declarations.length === 1
          && ts.isVariableStatement(list.parent) ? list.parent : node;
        addSymbol(q(vn), 'variable-function', whole);
        ts.forEachChild(node, (c) => visit(c, [...scope, vn]));
        return;
      }
    }
    ts.forEachChild(node, (c) => visit(c, scope));
  };
  visit(sf, []);
  imports.sort((a, b) => a.line - b.line);
  calls.sort((a, b) => a.start - b.start);
  bindings.sort((a, b) => a.start - b.start);

  return { path: fileName, text, imports, exportedTypeAliases, symbols, calls, bindings };
}

/** Read and parse one file. */
export function parseFile(file: string): ParsedFile {
  return parseSource(readFileSync(file, 'utf8'), file);
}
