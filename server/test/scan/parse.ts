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
 * by a later `export { X }` is not an exported type alias; `require(…)` calls are not import edges; a `Record<X, true>`
 * counts only as a variable's annotation or a `satisfies` type, and only with `X` named bare (D-6048).
 */
import { readFileSync } from 'node:fs';
import ts from 'typescript-api';

/** One module edge: an `import`, an `export … from`, an `import x = require(…)`, a literal `import(…)` or a type
 *  query `import('…').T` / `typeof import('…')`, always type-only (D-6045: ARCH-04's ring rules see a type reached
 *  that way as they see an `import type`). */
export interface ImportEdge {
  specifier: string;
  kind: 'import' | 'export-from' | 'import-equals' | 'dynamic' | 'type-query';
  /** `import type …`, `export type … from`, `import type x = require(…)`. A per-name `type` leaves this false. */
  typeOnly: boolean;
  /** The bound names: `default` as its local name, a namespace as `* as x`, named ones by their imported name. */
  names: string[];
  /** The named ones bound with a per-name `type` (`import { type A, b }` → `['A']`), for an `import` or an
   *  `export … from`; absent on the other kinds. An edge whose every name is here binds no value (D-6045, stage 2). */
  typeNames?: string[];
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

/** An equality comparison (`===`, `!==`, `==`, `!=`), in source order. `leftLeaf`/`rightLeaf` are each operand's last name
 *  (`a.b.sessionId`, `a!.sessionId`, `o['sessionId']` and `sessionId` all read `sessionId`; `null` for any other shape);
 *  `absent` is true when an operand is `null`, `undefined` or `void …`, so a presence check is told from a comparison
 *  of two values. `text` is the comparison's source with line breaks and their indentation removed. */
export interface Comparison {
  leftLeaf: string | null;
  rightLeaf: string | null;
  absent: boolean;
  text: string;
  start: number;
  line: number;
}

export interface ParsedFile {
  path: string;
  text: string;
  imports: ImportEdge[];
  exportedTypeAliases: TypeAlias[];
  symbols: SymbolSpan[];
  calls: CallSite[];
  bindings: Binding[];
  comparisons: Comparison[];
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

/** The last name of an operand, through parentheses, `!` and `as`; `null` when it has none. */
const leafNameOf = (e: ts.Expression): string | null => {
  let n: ts.Expression = e;
  while (ts.isParenthesizedExpression(n) || ts.isNonNullExpression(n) || ts.isAsExpression(n)) n = n.expression;
  if (ts.isIdentifier(n)) return n.text;
  if (ts.isPropertyAccessExpression(n)) return n.name.text;
  if (ts.isElementAccessExpression(n) && ts.isStringLiteralLike(n.argumentExpression)) return n.argumentExpression.text;
  return null;
};

const isAbsentValue = (e: ts.Expression): boolean =>
  e.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(e) && e.text === 'undefined') || ts.isVoidExpression(e);

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

/** The bare `X` of a `Record<X, true>` inside `t` (or `Readonly<Record<X, true>>`), else `null`. */
const recordTrueKey = (t: ts.TypeNode): string | null => {
  if (!ts.isTypeReferenceNode(t) || !ts.isIdentifier(t.typeName)) return null;
  const args = t.typeArguments ?? [];
  if (t.typeName.text === 'Readonly' && args.length === 1) return recordTrueKey(args[0]!);
  if (t.typeName.text !== 'Record' || args.length !== 2) return null;
  const [k, v] = [args[0]!, args[1]!];
  return ts.isTypeReferenceNode(k) && ts.isIdentifier(k.typeName) && !k.typeArguments
    && ts.isLiteralTypeNode(v) && v.literal.kind === ts.SyntaxKind.TrueKeyword ? k.typeName.text : null;
};

/** D-6048 (ARCH-12): the wire-totality facts of one parsed file, read by a walk of their own (kept out of
 *  `ParsedFile` so the shared walk stays one owner's). Runtime-bearing forms only. */
export interface WireFacts {
  /** The `X` of every `Record<X, true>` (bare or inside `Readonly<…>`) typing a non-`declare` variable or a
   *  `satisfies` expression: a map that fails to compile when `X` gains a member. Bare type names only. */
  recordTrueKeys: string[];
  /** The `X` of every `v is X` predicate on a function, method or arrow WITH a body; not `asserts v is X`, not a
   *  type-only signature. Bare type names only. */
  guardedTypes: string[];
  /** Every string literal the file compares against by hand: an operand of `===`, `!==`, `==` or `!=`, or a `case`
   *  label. In source order, repeats kept. */
  comparedLiterals: string[];
}

const EQUALITY = new Set<ts.SyntaxKind>([ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken]);

const isDeclared = (d: ts.VariableDeclaration): boolean => {
  const stmt = d.parent?.parent;
  return !!stmt && ts.isVariableStatement(stmt)
    && !!stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.DeclareKeyword);
};

const hasBody = (n: ts.Node): boolean =>
  (ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) || ts.isMethodDeclaration(n))
  && n.body !== undefined;

/** The wire-totality facts of `p` (D-6048). */
export function wireFacts(p: ParsedFile): WireFacts {
  const sf = ts.createSourceFile(p.path, p.text, ts.ScriptTarget.Latest, true, scriptKindOf(p.path));
  const out: WireFacts = { recordTrueKeys: [], guardedTypes: [], comparedLiterals: [] };
  const visit = (node: ts.Node): void => {
    const rk = ts.isVariableDeclaration(node) && node.type && !isDeclared(node) ? recordTrueKey(node.type)
      : ts.isSatisfiesExpression(node) ? recordTrueKey(node.type) : null;
    if (rk !== null) out.recordTrueKeys.push(rk);
    if (ts.isTypePredicateNode(node) && !node.assertsModifier && node.type && ts.isTypeReferenceNode(node.type)
      && ts.isIdentifier(node.type.typeName) && !node.type.typeArguments && hasBody(node.parent)) {
      out.guardedTypes.push(node.type.typeName.text);
    }
    const operands = ts.isBinaryExpression(node) && EQUALITY.has(node.operatorToken.kind) ? [node.left, node.right]
      : ts.isCaseClause(node) ? [node.expression] : [];
    for (const o of operands) if (ts.isStringLiteralLike(o)) out.comparedLiterals.push(o.text);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** D-5862 (ARCH-68): the lane-schedule facts of one parsed file, read by a walk of their own (as `wireFacts` is), so the
 *  census module imports no parser. Syntax only. */
export interface ScheduleFacts {
  /** Every property declaration of every class: the class, the name, whether it is numeric (a numeric literal or
   *  `-Infinity` initialiser, or a `number` type, bare or nullable), and its 1-based line. */
  fields: Array<{ cls: string; name: string; numeric: boolean; line: number }>;
  /** Every relational comparison (`<`, `<=`, `>`, `>=`) one side of which is `<anything> - this.F`: the enclosing class
   *  (`null` outside one), the field `F`, what the other side is (`name` an UPPER_CASE identifier, `literal` a numeric
   *  literal, `product` a product of those, `other` anything else), and whether that other side is a bare millisecond literal
   *  (a numeric literal of 1000 or more, or a product with one). */
  comparisons: Array<{ cls: string | null; field: string; other: 'name' | 'literal' | 'product' | 'other'; literalMs: boolean; line: number }>;
  /** Every top-level `const NAME = <initialiser>;`: whether the initialiser is a bare identifier (a reference). */
  constants: Array<{ name: string; reference: boolean; line: number }>;
}

const RELATIONAL = new Set<ts.SyntaxKind>([ts.SyntaxKind.LessThanToken, ts.SyntaxKind.LessThanEqualsToken,
  ts.SyntaxKind.GreaterThanToken, ts.SyntaxKind.GreaterThanEqualsToken]);

/** The lane-schedule facts of `p` (D-5862). */
export function scheduleFacts(p: ParsedFile): ScheduleFacts {
  const sf = ts.createSourceFile(p.path, p.text, ts.ScriptTarget.Latest, true, scriptKindOf(p.path));
  const lineOf = (n: ts.Node): number => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const out: ScheduleFacts = { fields: [], comparisons: [], constants: [] };
  const strip = (e: ts.Expression): ts.Expression => (ts.isParenthesizedExpression(e) ? strip(e.expression) : e);
  const num = (e: ts.Expression): number | null => (ts.isNumericLiteral(e) ? Number(e.text.replace(/_/g, '')) : null);
  const classify = (raw: ts.Expression): { other: 'name' | 'literal' | 'product' | 'other'; literalMs: boolean } => {
    const e = strip(raw);
    if (ts.isNumericLiteral(e)) return { other: 'literal', literalMs: (num(e) ?? 0) >= 1000 };
    if (ts.isIdentifier(e) && /^[A-Z][A-Z0-9_]*$/.test(e.text)) return { other: 'name', literalMs: false };
    if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.AsteriskToken) {
      const l = classify(e.left); const r = classify(e.right);
      if (l.other !== 'other' && r.other !== 'other') return { other: 'product', literalMs: l.literalMs || r.literalMs };
    }
    return { other: 'other', literalMs: false };
  };
  const clockField = (raw: ts.Expression): string | null => {
    const b = strip(raw);
    if (!ts.isBinaryExpression(b) || b.operatorToken.kind !== ts.SyntaxKind.MinusToken) return null;
    const r = strip(b.right);
    return ts.isPropertyAccessExpression(r) && r.expression.kind === ts.SyntaxKind.ThisKeyword ? r.name.text : null;
  };
  const visit = (node: ts.Node, cls: string | null): void => {
    const here = ts.isClassDeclaration(node) ? node.name?.text ?? null : cls;
    if (ts.isPropertyDeclaration(node) && ts.isIdentifier(node.name) && here !== null) {
      const init = node.initializer;
      const numericInit = init !== undefined && (ts.isNumericLiteral(init) || (ts.isPrefixUnaryExpression(init)
        && (ts.isNumericLiteral(init.operand) || (ts.isIdentifier(init.operand) && init.operand.text === 'Infinity'))));
      const type = node.type?.getText(sf) ?? '';
      const numericType = /(^|\|)\s*number\s*(\||$)/.test(type);
      out.fields.push({ cls: here, name: node.name.text, numeric: numericInit || numericType, line: lineOf(node) });
    }
    if (ts.isBinaryExpression(node) && RELATIONAL.has(node.operatorToken.kind)) {
      for (const [a, b] of [[node.left, node.right], [node.right, node.left]] as const) {
        const f = clockField(a);
        if (f !== null) { out.comparisons.push({ cls: here, field: f, ...classify(b), line: lineOf(node) }); break; }
      }
    }
    ts.forEachChild(node, (c) => visit(c, here));
  };
  visit(sf, null);
  for (const st of sf.statements) {
    if (!ts.isVariableStatement(st)) continue;
    for (const d of st.declarationList.declarations) {
      if (ts.isIdentifier(d.name) && d.initializer !== undefined) {
        out.constants.push({ name: d.name.text, reference: ts.isIdentifier(d.initializer), line: lineOf(d) });
      }
    }
  }
  return out;
}

const unionLiterals = (t: ts.TypeNode): string[] | null => {
  const members = ts.isUnionTypeNode(t) ? [...t.types] : [t];
  const out = members.map(literalText);
  return out.every((x): x is string => x !== null) ? out : null;
};

/** Parse TypeScript (or JS/TSX, by `fileName`'s extension) text. Syntax only. */
/** One reference to a named identifier (`identifierReferences`). `role`: `import` for an import specifier (`imported` is
 *  the module's name for it, `name` the local one), `call` for the callee of a call (`f(…)`, or the property of
 *  `ns.f(…)`), `other` for anything else (an export specifier, a copy, a destructure, a value passed on). `context` is
 *  the parent node's source with line breaks removed, `line` 1-based. */
export interface IdentifierReference {
  name: string;
  role: 'import' | 'call' | 'other';
  imported: string | null;
  line: number;
  context: string;
}

/** Every identifier of `text` whose text is in `names` (and, transitively, the local alias of any import specifier that
 *  imports one of them, `import { a as b }` adding `b`), in source order. Property names count (`ns.a`, `{ a: x }`). */
export function identifierReferences(text: string, fileName: string, names: ReadonlySet<string>): IdentifierReference[] {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, scriptKindOf(fileName));
  const wanted = new Set(names);
  const collectAliases = (n: ts.Node): void => {
    if (ts.isImportSpecifier(n) && wanted.has((n.propertyName ?? n.name).text)) wanted.add(n.name.text);
    ts.forEachChild(n, collectAliases);
  };
  collectAliases(sf);
  const out: IdentifierReference[] = [];
  const isCallee = (id: ts.Node): boolean => {
    const p = id.parent;
    if (ts.isCallExpression(p) && p.expression === id) return true;
    return ts.isPropertyAccessExpression(p) && p.name === id && ts.isCallExpression(p.parent) && p.parent.expression === p;
  };
  const visit = (n: ts.Node): void => {
    if (ts.isIdentifier(n) && wanted.has(n.text)) {
      const p = n.parent;
      const imp = ts.isImportSpecifier(p);
      out.push({
        name: n.text,
        role: imp ? 'import' : isCallee(n) ? 'call' : 'other',
        imported: imp ? (p.propertyName ?? p.name).text : null,
        line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1,
        context: p.getText(sf).replace(/\s*\n\s*/g, ' '),
      });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

export function parseSource(text: string, fileName = 'source.ts'): ParsedFile {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, scriptKindOf(fileName));
  const lineOf = (pos: number): number => sf.getLineAndCharacterOfPosition(pos).line + 1;
  const imports: ImportEdge[] = [];
  const exportedTypeAliases: TypeAlias[] = [];
  const symbols: SymbolSpan[] = [];
  const calls: CallSite[] = [];
  const bindings: Binding[] = [];
  const comparisons: Comparison[] = [];
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
      const typeNames: string[] = [];
      if (nb && ts.isNamedImports(nb)) {
        for (const e of nb.elements) {
          names.push((e.propertyName ?? e.name).text);
          if (e.isTypeOnly) typeNames.push((e.propertyName ?? e.name).text);
        }
      }
      imports.push({ specifier: st.moduleSpecifier.text, kind: 'import',
        typeOnly: c?.phaseModifier === ts.SyntaxKind.TypeKeyword, names, typeNames, line: lineOf(st.getStart(sf)) });
    } else if (ts.isExportDeclaration(st) && st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier)) {
      const ec = st.exportClause;
      const names = !ec ? ['*']
        : ts.isNamespaceExport(ec) ? [`* as ${nameText(ec.name) ?? ''}`]
          : ec.elements.map((e) => nameText(e.propertyName ?? e.name) ?? '');
      const typeNames = ec && ts.isNamedExports(ec)
        ? ec.elements.filter((e) => e.isTypeOnly).map((e) => nameText(e.propertyName ?? e.name) ?? '') : [];
      imports.push({ specifier: st.moduleSpecifier.text, kind: 'export-from', typeOnly: st.isTypeOnly, names, typeNames,
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
    if (ts.isBinaryExpression(node) && (node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken
      || node.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken
      || node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsToken
      || node.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsToken)) {
      const start = node.getStart(sf);
      comparisons.push({ leftLeaf: leafNameOf(node.left), rightLeaf: leafNameOf(node.right),
        absent: isAbsentValue(node.left) || isAbsentValue(node.right), text: flat(node), start, line: lineOf(start) });
    }
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
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
      // The qualifier's first name (`FastifyReply` in `import('fastify').FastifyReply`); none for `typeof import(…)`.
      let q: ts.EntityName | undefined = node.qualifier;
      while (q && ts.isQualifiedName(q)) q = q.left;
      imports.push({ specifier: node.argument.literal.text, kind: 'type-query', typeOnly: true,
        names: q ? [q.text] : [], line: lineOf(node.getStart(sf)) });
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
  comparisons.sort((a, b) => a.start - b.start);

  return { path: fileName, text, imports, exportedTypeAliases, symbols, calls, bindings, comparisons };
}

/** Read and parse one file. */
export function parseFile(file: string): ParsedFile {
  return parseSource(readFileSync(file, 'utf8'), file);
}

/** One piece of string text in the source: a string literal, a no-substitution template, or one literal part of a
 *  template (its head or the text after a `${…}`). Pieces split at every `${…}`, so a word built across one is not
 *  in any piece. `text` is the cooked value; `line` is 1-based, where the piece starts. */
export interface StringPiece {
  text: string;
  line: number;
}

/** Every string piece in a source text, in source order (D-6051: the ccd stub scanner reads the bash a test holds).
 *  KNOWN WIDTH: pieces are cooked text, and a template nested inside a `${…}` yields pieces of its own. */
export function stringPieces(text: string, fileName = 'source.ts'): StringPiece[] {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, scriptKindOf(fileName));
  const out: StringPiece[] = [];
  const add = (t: string, node: ts.Node): void => {
    out.push({ text: t, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1 });
  };
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) add(node.text, node);
    else if (ts.isTemplateExpression(node)) {
      add(node.head.text, node.head);
      for (const s of node.templateSpans) add(s.literal.text, s.literal);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** A string-valued expression: a string literal, a template, or a `+` chain of them (how a long SQL statement is
 *  written across lines). `text` is the cooked value with each `${…}` replaced by `${}`; `start`/`end` span the
 *  whole expression in the source; `line` is 1-based, where it starts. `partial` is true when the expression is an
 *  operand of a larger `+` chain that is NOT wholly string text (`'UPDATE t SET a = ?, ' + cond + ' WHERE …'`): its
 *  `text` is then only a fragment of the statement, and `chainStart`/`chainEnd` span the whole chain (else the
 *  expression itself), so a census can read the raw source of the statement the fragment belongs to. */
export interface StringExpression {
  text: string;
  start: number;
  end: number;
  line: number;
  partial: boolean;
  chainStart: number;
  chainEnd: number;
}

/** The maximal string-valued expressions of a source text, in source order (ARCH-06: `sqlStatementsIn` reads the SQL a
 *  store holds). A chain counts only when every operand is a string literal, a template or a parenthesised chain, so
 *  `'a' + x` is two expressions, not one. KNOWN WIDTH: a substitution's own text is not read, and a template nested
 *  inside a `${…}` is an expression of its own. */
export function stringExpressions(text: string, fileName = 'source.ts'): StringExpression[] {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, scriptKindOf(fileName));
  const out: StringExpression[] = [];
  /** The cooked value of `n` when it is wholly string text, else `null`. */
  const valueOf = (n: ts.Node): string | null => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
    if (ts.isTemplateExpression(n)) return n.head.text + n.templateSpans.map((s) => '${}' + s.literal.text).join('');
    if (ts.isParenthesizedExpression(n)) return valueOf(n.expression);
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const l = valueOf(n.left);
      const r = l === null ? null : valueOf(n.right);
      return r === null ? null : l + r;
    }
    return null;
  };
  const visit = (node: ts.Node): void => {
    const v = valueOf(node);
    if (v !== null && !ts.isParenthesizedExpression(node)) {
      // The outermost `+` chain this operand sits in (parentheses looked through): its span is the statement's source.
      let top: ts.Node = node;
      while (top.parent && (ts.isParenthesizedExpression(top.parent)
        || (ts.isBinaryExpression(top.parent) && top.parent.operatorToken.kind === ts.SyntaxKind.PlusToken))) top = top.parent;
      out.push({ text: v, start: node.getStart(sf), end: node.getEnd(), line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
        partial: top !== node, chainStart: top.getStart(sf), chainEnd: top.getEnd() });
      // A template's substitutions can hold strings of their own.
      if (ts.isTemplateExpression(node)) node.templateSpans.forEach((s) => visit(s.expression));
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** One parse per (file name, text), kept for the last text of each file: `inlinedSourceOf` asks for many positions of one file. */
const sourceFiles = new Map<string, { text: string; sf: ts.SourceFile }>();
const sourceFileOf = (text: string, fileName: string): ts.SourceFile => {
  const hit = sourceFiles.get(fileName);
  if (hit && hit.text === text) return hit.sf;
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, scriptKindOf(fileName));
  sourceFiles.set(fileName, { text, sf });
  return sf;
};

/** The offset where the statement holding `pos` starts: the innermost statement that sits in a block, a source file or a
 *  case clause (so `void this.x(…)`, `const a = this.x(…)` and `await this.x(…)` all start at their first keyword).
 *  `pos` outside every statement gives `pos`. */
export function statementStartAt(text: string, pos: number, fileName = 'source.ts'): number {
  const sf = sourceFileOf(text, fileName);
  let found = pos;
  const visit = (n: ts.Node): void => {
    if (pos < n.getStart(sf) || pos >= n.getEnd()) return;
    if (ts.isStatement(n) && (ts.isBlock(n.parent) || ts.isSourceFile(n.parent) || ts.isCaseOrDefaultClause(n.parent)
      || ts.isModuleBlock(n.parent))) found = n.getStart(sf);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return found;
}
